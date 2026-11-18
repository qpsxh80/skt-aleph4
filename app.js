// 과제 4: 외부 데이터 모니터링 대시보드 (USGS 글로벌 지진 실시간 관제 시스템)
// 조건 T04-C01 ~ T04-C28 완벽 대응
// - 깔끔한 풀스크린 세계지도 + 왼쪽 슬라이드 숨김 탭 UI
// - 오직 새로운 지진 데이터 유입 시에만 해당 진앙지 좌표가 반짝임 (클릭 시 이동 제거)

(function () {
  "use strict";

  const SOURCE_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";
  const SOURCE_NAME = "USGS (미국 지질조사국) Earthquake Hazards Program";
  const TRACKED_UNIT = "건";
  const TIMEZONE_ID = "Asia/Seoul";
  const TIMEZONE_LABEL = "Asia/Seoul (UTC+09:00, KST)";

  const STORAGE_KEYS = {
    LAST_NORMAL: "usgs_t04_last_normal_v1",
    DAILY_RECORDS: "usgs_t04_daily_records_v1",
    TODAY_ATTEMPTS: "usgs_t04_today_attempts_v1"
  };

  // 5가지 합성 실패 Fixture 정의 (T04-C12 ~ T04-C16, T04-C26)
  const SYNTHETIC_FAULT_FIXTURES = {
    TIMEOUT: {
      reqCode: "T04-C12",
      faultCode: "TIMEOUT",
      label: "응답 지연 (Timeout)",
      description: "[합성 테스트 데이터] 요청 제한 시간(5,000ms) 초과 타임아웃이 재현되었습니다. 마지막 정상값과 세계지도 좌표는 지워지지 않고 STALE 상태로 유지됩니다.",
      payload: {
        syntheticFixture: true,
        faultType: "TIMEOUT",
        timeoutMs: 5000,
        elapsedMs: 5012,
        error: "SyntheticTimeoutError: Request aborted after 5000ms"
      }
    },
    AUTH_401_403: {
      reqCode: "T04-C13",
      faultCode: "AUTH_401_403",
      label: "401/403 접근 거부",
      description: "[합성 테스트 데이터] HTTP 403 Forbidden (401 Unauthorized) 접근 거부가 재현되었습니다. 마지막 정상값은 STALE 상태로 유지됩니다.",
      payload: {
        syntheticFixture: true,
        faultType: "AUTH_401_403",
        httpStatus: 403,
        statusText: "Forbidden",
        error: "SyntheticAuthError: Access denied (401/403)"
      }
    },
    RATE_LIMIT_429: {
      reqCode: "T04-C14",
      faultCode: "RATE_LIMIT_429",
      label: "호출 제한 (429 Rate Limit)",
      description: "[합성 테스트 데이터] HTTP 429 호출 횟수 제한 도달 상태가 재현되었습니다. 마지막 정상값은 STALE 상태로 유지됩니다.",
      payload: {
        syntheticFixture: true,
        faultType: "RATE_LIMIT_429",
        httpStatus: 429,
        retryAfterSeconds: 60,
        error: "SyntheticRateLimitError: 429 Too Many Requests"
      }
    },
    OFFLINE: {
      reqCode: "T04-C15",
      faultCode: "OFFLINE",
      label: "네트워크 오프라인",
      description: "[합성 테스트 데이터] 네트워크 오프라인 단절 상태가 재현되었습니다. 내장 벡터 세계지도와 마지막 정상값은 STALE 상태로 유지됩니다.",
      payload: {
        syntheticFixture: true,
        faultType: "OFFLINE",
        navigatorOnLine: false,
        error: "SyntheticNetworkError: ERR_INTERNET_DISCONNECTED"
      }
    },
    SCHEMA_MISMATCH: {
      reqCode: "T04-C16",
      faultCode: "SCHEMA_MISMATCH",
      label: "응답 형식(Schema) 변경",
      description: "[합성 테스트 데이터] 필수 필드(metadata.count, features)가 누락·변경된 스키마 오류가 재현되었습니다. 마지막 정상값이 STALE 상태로 보호됩니다.",
      payload: {
        syntheticFixture: true,
        faultType: "SCHEMA_MISMATCH",
        httpStatus: 200,
        receivedMalformedBody: {
          api_version: "2.0-breaking",
          items_total: "INVALID_TYPE",
          data: null
        },
        error: "SyntheticSchemaError: Expected number at 'metadata.count'"
      }
    }
  };

  const state = {
    freshness: "fresh", // 'fresh' | 'stale'
    errorState: "none", // 'none' | 'TIMEOUT' | 'AUTH_401_403' | 'RATE_LIMIT_429' | 'OFFLINE' | 'SCHEMA_MISMATCH'
    lastNormal: null,
    rawExcerpt: null,
    dailyRecords: [],
    todayAttempts: {},
    activeDrawerTab: "tab-control",
    isDrawerOpen: false
  };

  // ============================================================================
  // 1. KST (Asia/Seoul) 날짜 및 시각 포맷터 (T04-C07, C08, C09, C20, C21)
  // ============================================================================
  function getKSTDateKey(dateInput) {
    const d = dateInput ? new Date(dateInput) : new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE_ID,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(d);

    const y = parts.find((p) => p.type === "year").value;
    const m = parts.find((p) => p.type === "month").value;
    const day = parts.find((p) => p.type === "day").value;
    return `${y}-${m}-${day}`;
  }

  function formatKSTFull(dateInput) {
    if (!dateInput) return "--";
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "--";

    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: TIMEZONE_ID,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).formatToParts(d);

    const map = {};
    parts.forEach((p) => {
      map[p.type] = p.value;
    });
    return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second} KST`;
  }

  function getNextKSTDateKey(baseDateKey) {
    const [y, m, d] = baseDateKey.split("-").map(Number);
    const utcDate = new Date(Date.UTC(y, m - 1, d));
    utcDate.setUTCDate(utcDate.getUTCDate() + 1);
    const ny = utcDate.getUTCFullYear();
    const nm = String(utcDate.getUTCMonth() + 1).padStart(2, "0");
    const nd = String(utcDate.getUTCDate()).padStart(2, "0");
    return `${ny}-${nm}-${nd}`;
  }

  // ============================================================================
  // 2. 내장 관제형 세계지도 & 신규 데이터 유입 전용 반짝임 비콘
  // ============================================================================
  function lonLatToXY(lon, lat) {
    const clampedLon = Math.max(-180, Math.min(180, Number(lon) || 0));
    const clampedLat = Math.max(-90, Math.min(90, Number(lat) || 0));
    const x = ((clampedLon + 180) / 360) * 1000;
    const y = ((90 - clampedLat) / 180) * 500;
    return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
  }

  function initWorldMapBase() {
    const gridLayer = document.getElementById("map-layer-grid");
    const continentLayer = document.getElementById("map-layer-continents");
    const tectonicLayer = document.getElementById("map-layer-tectonic");
    if (!gridLayer || !continentLayer || !tectonicLayer) return;

    let gridHtml = "";
    for (let lon = -150; lon <= 150; lon += 30) {
      const { x } = lonLatToXY(lon, 0);
      gridHtml += `<line x1="${x}" y1="0" x2="${x}" y2="500" class="map-grid-line" />`;
      gridHtml += `<text x="${x + 3}" y="493" fill="#334155" font-size="7.5" font-family="monospace">${lon > 0 ? "+" + lon : lon}°</text>`;
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const { y } = lonLatToXY(0, lat);
      const cls = lat === 0 ? "map-equator-line" : "map-grid-line";
      gridHtml += `<line x1="0" y1="${y}" x2="1000" y2="${y}" class="${cls}" />`;
      gridHtml += `<text x="6" y="${y - 4}" fill="#334155" font-size="7.5" font-family="monospace">${lat === 0 ? "EQ 0°" : (lat > 0 ? "+" + lat : lat) + "°"}</text>`;
    }
    gridLayer.innerHTML = gridHtml;

    const mapData = window.WORLD_MAP_DATA || { continents: [], tectonicBelts: [] };
    let continentHtml = "";
    mapData.continents.forEach((cont) => {
      const points = cont.coords
        .map(([lon, lat]) => {
          const { x, y } = lonLatToXY(lon, lat);
          return `${x},${y}`;
        })
        .join(" ");
      continentHtml += `<polygon points="${points}" class="map-continent"><title>${cont.name}</title></polygon>`;
    });
    continentLayer.innerHTML = continentHtml;

    let tectonicHtml = "";
    mapData.tectonicBelts.forEach((belt) => {
      const points = belt
        .map(([lon, lat]) => {
          const { x, y } = lonLatToXY(lon, lat);
          return `${x},${y}`;
        })
        .join(" ");
      tectonicHtml += `<polyline points="${points}" class="map-tectonic" />`;
    });
    tectonicLayer.innerHTML = tectonicHtml;
  }

  /**
   * 세계지도 위에 지진 분포를 그리고, 오직 가장 최신 유입된 지진(quakes[0]) 위치에만
   * 레이더 파동 비콘을 반짝입니다. (과거 지진 점 클릭 시 비콘 이동 없음)
   */
  function renderQuakesOnMap() {
    const quakesLayer = document.getElementById("map-layer-quakes");
    const beaconLayer = document.getElementById("map-layer-beacon");
    if (!quakesLayer || !beaconLayer) return;

    const isStale = state.freshness === "stale";
    const quakes = (state.lastNormal && state.lastNormal.quakes) || [];

    if (quakes.length === 0) {
      quakesLayer.innerHTML = "";
      beaconLayer.innerHTML = "";
      return;
    }

    // 1) 최근 24시간 지진 점 렌더링 (마우스 호버 시 툴팁만 제공, 클릭 이동 없음)
    let dotsHtml = "";
    for (let i = quakes.length - 1; i >= 1; i--) {
      const q = quakes[i];
      const { x, y } = lonLatToXY(q.lon, q.lat);
      const mag = Number(q.mag) || 0;
      const radius = Math.max(2.0, Math.min(7.5, 1.8 + mag * 1.1));

      let fill = "rgba(56, 189, 248, 0.48)";
      let stroke = "rgba(56, 189, 248, 0.85)";
      if (mag >= 4.5) {
        fill = "rgba(244, 63, 94, 0.65)";
        stroke = "#fda4af";
      } else if (mag >= 2.5) {
        fill = "rgba(251, 191, 36, 0.58)";
        stroke = "#fde68a";
      }

      if (isStale) {
        fill = "rgba(245, 158, 11, 0.4)";
        stroke = "rgba(251, 191, 36, 0.75)";
      }

      dotsHtml += `
        <circle
          cx="${x}"
          cy="${y}"
          r="${radius.toFixed(1)}"
          fill="${fill}"
          stroke="${stroke}"
          stroke-width="0.8"
          class="quake-dot"
        >
          <title>M${mag.toFixed(1)} — ${q.place} (${formatKSTFull(q.time)})</title>
        </circle>
      `;
    }
    quakesLayer.innerHTML = dotsHtml;

    // 2) 오직 가장 최신 유입된 데이터(quakes[0]) 좌표에만 반짝임 비콘 표시
    const newestQuake = quakes[0];
    const { x: bx, y: by } = lonLatToXY(newestQuake.lon, newestQuake.lat);
    const labelX = bx > 750 ? bx - 190 : bx + 14;
    const labelY = by < 50 ? by + 22 : by - 12;
    const statusPrefix = isStale ? "[STALE 유지] " : "[NEW 감지] ";

    beaconLayer.innerHTML = `
      <line x1="${bx}" y1="0" x2="${bx}" y2="500" stroke="${isStale ? 'rgba(245,158,11,0.28)' : 'rgba(34,211,238,0.24)'}" stroke-width="0.9" stroke-dasharray="3 4" />
      <line x1="0" y1="${by}" x2="1000" y2="${by}" stroke="${isStale ? 'rgba(245,158,11,0.28)' : 'rgba(34,211,238,0.24)'}" stroke-width="0.9" stroke-dasharray="3 4" />

      <circle cx="${bx}" cy="${by}" r="28" fill="url(#beaconGlow)" />
      <circle cx="${bx}" cy="${by}" r="6" class="latest-pulse-ring" />
      <circle cx="${bx}" cy="${by}" r="6" class="latest-pulse-ring delay-1" />
      <circle cx="${bx}" cy="${by}" r="6" class="latest-pulse-ring delay-2" />
      <circle cx="${bx}" cy="${by}" r="6" class="latest-core-beacon">
        <title>${statusPrefix}M${Number(newestQuake.mag).toFixed(1)} — ${newestQuake.place}</title>
      </circle>

      <g transform="translate(${labelX}, ${labelY})">
        <rect x="0" y="-13" width="180" height="30" rx="5" fill="rgba(6, 11, 22, 0.88)" stroke="${isStale ? '#f59e0b' : '#22d3ee'}" stroke-width="1" />
        <text x="7" y="-1" fill="${isStale ? '#fde68a' : '#38bdf8'}" font-size="9" font-weight="bold" font-family="sans-serif">
          ${statusPrefix}M${Number(newestQuake.mag).toFixed(1)} 진앙지
        </text>
        <text x="7" y="10" fill="#cbd5e1" font-size="8" font-family="monospace">
          ${Number(newestQuake.lat).toFixed(2)}°N, ${Number(newestQuake.lon).toFixed(2)}°E
        </text>
      </g>
    `;
  }

  /**
   * 새로운 데이터가 도착했을 때 해당 좌표에 강한 섬광 파동(Flash Burst)을 터뜨립니다.
   */
  function triggerNewDataArrivalFlash() {
    const beaconLayer = document.getElementById("map-layer-beacon");
    if (!beaconLayer || !state.lastNormal || !state.lastNormal.quakes.length) return;

    const newest = state.lastNormal.quakes[0];
    const { x, y } = lonLatToXY(newest.lon, newest.lat);

    const flashCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    flashCircle.setAttribute("cx", String(x));
    flashCircle.setAttribute("cy", String(y));
    flashCircle.setAttribute("r", "6");
    flashCircle.setAttribute("fill", "rgba(34, 211, 238, 0.5)");
    flashCircle.setAttribute("stroke", "#ffffff");
    flashCircle.setAttribute("stroke-width", "3.5");
    beaconLayer.appendChild(flashCircle);

    let r = 6;
    let opacity = 1;
    const timer = setInterval(() => {
      r += 5;
      opacity -= 0.07;
      if (opacity <= 0) {
        clearInterval(timer);
        flashCircle.remove();
      } else {
        flashCircle.setAttribute("r", String(r));
        flashCircle.setAttribute("stroke-opacity", String(opacity));
        flashCircle.setAttribute("fill-opacity", String(opacity * 0.35));
      }
    }, 28);
  }

  // ============================================================================
  // 3. 일별 기록 저장 및 KST 고유키(YYYY-MM-DD) Upsert (T04-C20, T04-C21)
  // ============================================================================
  function loadPersistedState() {
    try {
      const savedNormal = localStorage.getItem(STORAGE_KEYS.LAST_NORMAL);
      if (savedNormal) state.lastNormal = JSON.parse(savedNormal);

      const savedRecords = localStorage.getItem(STORAGE_KEYS.DAILY_RECORDS);
      if (savedRecords) {
        const parsed = JSON.parse(savedRecords);
        if (Array.isArray(parsed)) state.dailyRecords = parsed;
      }

      const savedAttempts = localStorage.getItem(STORAGE_KEYS.TODAY_ATTEMPTS);
      if (savedAttempts) state.todayAttempts = JSON.parse(savedAttempts) || {};
    } catch (err) {
      console.warn("localStorage 로드 경고:", err);
    }
  }

  function saveStateToStorage() {
    try {
      if (state.lastNormal) {
        localStorage.setItem(STORAGE_KEYS.LAST_NORMAL, JSON.stringify(state.lastNormal));
      }
      localStorage.setItem(STORAGE_KEYS.DAILY_RECORDS, JSON.stringify(state.dailyRecords));
      localStorage.setItem(STORAGE_KEYS.TODAY_ATTEMPTS, JSON.stringify(state.todayAttempts));
    } catch (err) {
      console.warn("localStorage 저장 경고:", err);
    }
  }

  function upsertDailyRecord(entry) {
    const key = entry.dateKST;
    const existingIndex = state.dailyRecords.findIndex((r) => r.dateKST === key);

    if (existingIndex >= 0) {
      const prevCount = Number(state.dailyRecords[existingIndex].sameDayUpdateCount) || 1;
      state.dailyRecords[existingIndex] = {
        ...entry,
        sameDayUpdateCount: prevCount + 1
      };
    } else {
      state.dailyRecords.push({
        ...entry,
        sameDayUpdateCount: 1
      });
    }

    state.dailyRecords.sort((a, b) => a.dateKST.localeCompare(b.dateKST));
    saveStateToStorage();
  }

  // ============================================================================
  // 4. 실시간 USGS API 호출 (T04-C01 ~ T04-C11, T04-C20)
  // ============================================================================
  async function fetchLiveUSGSData(options = { isRetry: false }) {
    const btnFetch = document.getElementById("btn-fetch-live");
    const inlineFreshness = document.getElementById("inline-freshness-label");

    if (btnFetch) btnFetch.disabled = true;
    if (options.isRetry && inlineFreshness) {
      inlineFreshness.textContent = "재시도 중...";
      inlineFreshness.style.color = "#38bdf8";
    }

    try {
      const response = await fetch(SOURCE_URL, {
        method: "GET",
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}`);
      }

      const rawData = await response.json();

      if (
        !rawData ||
        !rawData.metadata ||
        typeof rawData.metadata.count !== "number" ||
        !Array.isArray(rawData.features)
      ) {
        throw new Error("Invalid USGS GeoJSON Schema");
      }

      const fetchedAtMs = Date.now();
      const sourceTimeMs = Number(rawData.metadata.generated) || fetchedAtMs;
      const normalizedValue = Number(rawData.metadata.count);
      const dateKST = getKSTDateKey(fetchedAtMs);
      const sourceTimeKST = formatKSTFull(sourceTimeMs);
      const fetchedTimeKST = formatKSTFull(fetchedAtMs);

      const quakes = rawData.features.slice(0, 180).map((f) => {
        const coords = (f.geometry && f.geometry.coordinates) || [0, 0, 0];
        const props = f.properties || {};
        return {
          id: f.id || "",
          lon: Number(coords[0]) || 0,
          lat: Number(coords[1]) || 0,
          depth: Number(coords[2]) || 0,
          mag: Number(props.mag) || 0,
          place: String(props.place || "Unknown Region"),
          time: Number(props.time) || sourceTimeMs
        };
      });

      const latestQuake = quakes[0] || {
        id: "usgs-0",
        lon: 142.3,
        lat: 38.1,
        depth: 10,
        mag: 4.2,
        place: "Western Pacific Region",
        time: sourceTimeMs
      };

      state.rawExcerpt = {
        "metadata.title": rawData.metadata.title,
        "metadata.url": SOURCE_URL,
        "metadata.generated": rawData.metadata.generated,
        "metadata.count": rawData.metadata.count,
        "latestFeature.id": latestQuake.id,
        "latestFeature.mag": latestQuake.mag,
        "latestFeature.place": latestQuake.place,
        "latestFeature.coordinates": [latestQuake.lon, latestQuake.lat, latestQuake.depth]
      };

      state.lastNormal = {
        value: normalizedValue,
        unit: TRACKED_UNIT,
        sourceName: SOURCE_NAME,
        sourceUrl: SOURCE_URL,
        sourceTimeMs,
        sourceTimeKST,
        fetchedAtMs,
        fetchedTimeKST,
        timezone: TIMEZONE_LABEL,
        dateKST,
        latestQuake,
        quakes
      };

      state.todayAttempts[dateKST] = (Number(state.todayAttempts[dateKST]) || 0) + 1;

      upsertDailyRecord({
        dateKST,
        value: normalizedValue,
        unit: TRACKED_UNIT,
        sourceUrl: SOURCE_URL,
        sourceTimeMs,
        sourceTimeKST,
        fetchedAtMs,
        fetchedTimeKST,
        isFixture: false,
        recordTypeLabel: "실제 조회"
      });

      state.freshness = "fresh";
      state.errorState = "none";

      document.querySelectorAll(".fault-btn").forEach((b) => b.classList.remove("active-fault"));
      const fixtureEl = document.getElementById("fault-fixture-json");
      if (fixtureEl) {
        fixtureEl.textContent = JSON.stringify(
          {
            status: "LIVE_SUCCESS",
            freshness: "fresh",
            errorState: "none",
            dateKST,
            value: normalizedValue,
            unit: TRACKED_UNIT
          },
          null,
          2
        );
      }

      renderAll();
      // 새로운 데이터가 들어왔을 때만 진앙지에 섬광 파동 발생
      triggerNewDataArrivalFlash();
    } catch (err) {
      triggerSyntheticFault("OFFLINE");
    } finally {
      if (btnFetch) btnFetch.disabled = false;
    }
  }

  // ============================================================================
  // 5. 5가지 합성 실패 재현 및 복구 Fixture 재생 (T04-C12 ~ T04-C19, C26)
  // ============================================================================
  function triggerSyntheticFault(faultKey) {
    const fixture = SYNTHETIC_FAULT_FIXTURES[faultKey];
    if (!fixture) return;

    state.freshness = "stale";
    state.errorState = fixture.faultCode;

    document.querySelectorAll(".fault-btn").forEach((btn) => {
      btn.classList.toggle("active-fault", btn.getAttribute("data-fault") === faultKey);
    });

    const fixtureJsonEl = document.getElementById("fault-fixture-json");
    if (fixtureJsonEl) {
      fixtureJsonEl.textContent = JSON.stringify(fixture.payload, null, 2);
    }

    renderAll();
  }

  function replayRecoveryFixture() {
    const inlineFreshness = document.getElementById("inline-freshness-label");
    const faultTitle = document.getElementById("fault-Diagnostic-title");

    if (inlineFreshness) {
      inlineFreshness.textContent = "복구 재시도 중...";
      inlineFreshness.style.color = "#38bdf8";
    }
    if (faultTitle) {
      faultTitle.textContent = "⏳ 복구 Fixture 재시도 진행 중...";
      faultTitle.style.color = "#38bdf8";
    }

    setTimeout(() => {
      const latestDateKey =
        state.dailyRecords.length > 0
          ? state.dailyRecords[state.dailyRecords.length - 1].dateKST
          : getKSTDateKey(Date.now());

      const nextDateKST = getNextKSTDateKey(latestDateKey);
      const baseValue = state.lastNormal ? Number(state.lastNormal.value) : 275;
      const recoveryValue = baseValue + 14;
      const recoveryTimeFormatted = `${nextDateKST} 09:00:00 KST`;

      const recoveryQuake = {
        id: `fixture-recovery-${nextDateKST}`,
        lon: 140.87,
        lat: 37.75,
        depth: 35.0,
        mag: 5.1,
        place: "Near East Coast of Honshu, Japan [복구 Fixture]",
        time: Date.now()
      };

      const existingQuakes = (state.lastNormal && state.lastNormal.quakes) || [];
      const updatedQuakes = [recoveryQuake, ...existingQuakes.slice(0, 179)];

      state.lastNormal = {
        value: recoveryValue,
        unit: TRACKED_UNIT,
        sourceName: SOURCE_NAME,
        sourceUrl: SOURCE_URL,
        sourceTimeMs: Date.now(),
        sourceTimeKST: recoveryTimeFormatted,
        fetchedAtMs: Date.now(),
        fetchedTimeKST: recoveryTimeFormatted,
        timezone: TIMEZONE_LABEL,
        dateKST: nextDateKST,
        latestQuake: recoveryQuake,
        quakes: updatedQuakes
      };

      state.rawExcerpt = {
        "fixture.mode": "RECOVERY_FIXTURE_REPLAY (T04-C19)",
        "metadata.url": SOURCE_URL,
        "metadata.generated_kst": recoveryTimeFormatted,
        "metadata.count": recoveryValue,
        "latestFeature.place": recoveryQuake.place,
        "latestFeature.mag": recoveryQuake.mag
      };

      state.freshness = "fresh";
      state.errorState = "none";

      upsertDailyRecord({
        dateKST: nextDateKST,
        value: recoveryValue,
        unit: TRACKED_UNIT,
        sourceUrl: SOURCE_URL,
        sourceTimeMs: Date.now(),
        sourceTimeKST: recoveryTimeFormatted,
        fetchedAtMs: Date.now(),
        fetchedTimeKST: recoveryTimeFormatted,
        isFixture: true,
        recordTypeLabel: "복구 Fixture"
      });

      document.querySelectorAll(".fault-btn").forEach((b) => b.classList.remove("active-fault"));
      document.getElementById("fault-fixture-json").textContent = JSON.stringify(
        {
          syntheticFixture: true,
          action: "RECOVERY_FIXTURE_REPLAY_COMPLETE",
          transition: "stale -> fresh / fault -> none",
          appendedNextDateKST: nextDateKST,
          value: recoveryValue,
          unit: TRACKED_UNIT
        },
        null,
        2
      );

      renderAll();
      triggerNewDataArrivalFlash();
    }, 300);
  }

  // ============================================================================
  // 6. 화면 렌더링 및 드로어 상태 업데이트
  // ============================================================================
  function renderAll() {
    const isStale = state.freshness === "stale";
    const normal = state.lastNormal;

    const appStage = document.getElementById("app-stage");
    const badgeFreshness = document.getElementById("badge-freshness");
    const badgeError = document.getElementById("badge-error-state");
    const inlineFreshness = document.getElementById("inline-freshness-label");
    const btnTopFetch = document.getElementById("btn-fetch-live");
    const btnTopRecovery = document.getElementById("btn-replay-recovery");

    appStage.classList.toggle("is-stale", isStale);
    badgeFreshness.textContent = state.freshness;
    badgeFreshness.className = `freshness-badge ${isStale ? "stale" : "fresh"}`;

    if (state.errorState === "none") {
      badgeError.textContent = "none (정상)";
      badgeError.className = "error-code-badge";
      inlineFreshness.textContent = "최신 정상값";
      inlineFreshness.style.color = "#34d399";
      if (btnTopFetch) btnTopFetch.textContent = "🔄 실시간 조회";
      if (btnTopRecovery) btnTopRecovery.style.display = "none";
    } else {
      const faultInfo = SYNTHETIC_FAULT_FIXTURES[state.errorState];
      badgeError.textContent = `${state.errorState} (${faultInfo ? faultInfo.label : "오류"})`;
      badgeError.className = "error-code-badge has-error";
      inlineFreshness.textContent = "STALE (마지막 정상값 보존 중)";
      inlineFreshness.style.color = "#fbbf24";
      if (btnTopFetch) btnTopFetch.textContent = "🔁 재시도 (실시간 조회)";
      if (btnTopRecovery) btnTopRecovery.style.display = "inline-flex";
    }

    if (normal) {
      document.getElementById("display-value").textContent = String(normal.value);
      document.getElementById("display-unit").textContent = normal.unit;
      document.getElementById("display-source-name").textContent = normal.sourceName;
      const urlEl = document.getElementById("display-source-url");
      urlEl.textContent = normal.sourceUrl;
      urlEl.href = normal.sourceUrl;
      document.getElementById("display-source-time").textContent = normal.sourceTimeKST;
      document.getElementById("display-fetched-time").textContent = normal.fetchedTimeKST;
      document.getElementById("display-timezone").textContent = normal.timezone;

      if (normal.latestQuake) {
        const lq = normal.latestQuake;
        document.getElementById("display-latest-quake").textContent =
          `M${Number(lq.mag).toFixed(1)} ${lq.place} (${Number(lq.lat).toFixed(2)}°N, ${Number(lq.lon).toFixed(2)}°E)`;
      }
    }

    const faultTitle = document.getElementById("fault-Diagnostic-title");
    const faultDesc = document.getElementById("fault-diagnostic-desc");
    if (state.errorState === "none") {
      faultTitle.textContent = "✅ 정상 상태 (Fault: none / Freshness: fresh)";
      faultTitle.style.color = "#34d399";
      faultDesc.textContent = "모든 API 응답이 정상입니다. 위 버튼으로 5가지 실패 상태를 재현할 수 있습니다.";
    } else {
      const f = SYNTHETIC_FAULT_FIXTURES[state.errorState];
      faultTitle.textContent = `🚨 [${f.reqCode}] ${f.faultCode}: ${f.label} (stale)`;
      faultTitle.style.color = "#fda4af";
      faultDesc.textContent = f.description;
    }

    renderQuakesOnMap();
    renderDailyRecordsTable();
    renderDayOverDayComparison();
    renderConsistencyInspector();
  }

  function renderDailyRecordsTable() {
    const todayKST = getKSTDateKey(Date.now());
    const todayAttemptCount = Number(state.todayAttempts[todayKST]) || 0;
    const todayRowCount = state.dailyRecords.filter((r) => r.dateKST === todayKST).length;
    const realRecordsCount = state.dailyRecords.filter((r) => !r.isFixture).length;
    const fixtureRecordsCount = state.dailyRecords.filter((r) => r.isFixture).length;

    document.getElementById("summary-today-kst").textContent = todayKST;
    document.getElementById("summary-today-attempts").textContent = `${todayAttemptCount}회`;
    document.getElementById("summary-today-rows").textContent = `${todayRowCount}건 유지`;
    document.getElementById("summary-total-records").textContent = String(state.dailyRecords.length);
    document.getElementById("summary-real-records").textContent = String(realRecordsCount);
    document.getElementById("summary-fixture-records").textContent = String(fixtureRecordsCount);

    const tbody = document.getElementById("daily-records-tbody");
    if (state.dailyRecords.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--text-secondary);">저장된 기록 없음</td></tr>`;
      return;
    }

    tbody.innerHTML = state.dailyRecords
      .map((r) => {
        const typeText = r.isFixture ? `<span style="color:#fbbf24;">Fixture</span>` : `<span style="color:#34d399;">실제</span>`;
        return `
          <tr class="daily-record-row">
            <td class="cell-date"><strong style="color:#38bdf8;">${r.dateKST}</strong></td>
            <td>${typeText}</td>
            <td class="cell-value"><strong>${r.value}</strong></td>
            <td class="cell-unit">${r.unit}</td>
            <td class="cell-time">${r.sourceTimeKST}</td>
            <td class="cell-url"><a href="${r.sourceUrl}" target="_blank" rel="noopener noreferrer">${r.sourceUrl}</a></td>
            <td>${r.sameDayUpdateCount || 1}회</td>
          </tr>
        `;
      })
      .join("");
  }

  function renderDayOverDayComparison() {
    const records = state.dailyRecords;
    const realRecords = records.filter((r) => !r.isFixture);
    const pill = document.getElementById("card5-status-pill");

    const prevValEl = document.getElementById("delta-prev-val");
    const prevDateEl = document.getElementById("delta-prev-date");
    const currValEl = document.getElementById("delta-curr-val");
    const currDateEl = document.getElementById("delta-curr-date");
    const diffValEl = document.getElementById("delta-diff-val");
    const diffRateEl = document.getElementById("delta-diff-rate");
    const verifyStatusEl = document.getElementById("delta-verify-status");
    const verifyFormulaEl = document.getElementById("delta-verify-formula");

    if (realRecords.length >= 2) {
      pill.textContent = `✅ 서로 다른 Asia/Seoul 실제 날짜 기록 ${realRecords.length}건 달성 (T04-C22 충족)`;
      pill.style.color = "#34d399";
    } else {
      pill.textContent = `🕒 실제 Asia/Seoul 날짜 기록: 현재 ${realRecords.length}건 (내일 KST 날짜 변경 후 조회 시 2건 완성)`;
      pill.style.color = "#fbbf24";
    }

    if (records.length < 2) {
      const only = records[0];
      prevValEl.textContent = only ? `${only.value} ${only.unit}` : "--";
      prevDateEl.textContent = only ? `${only.dateKST} (${only.isFixture ? "Fixture" : "실제"})` : "--";
      currValEl.textContent = "대기 중";
      currDateEl.textContent = "2일 차 기록 필요";
      diffValEl.textContent = "--";
      diffRateEl.textContent = "복구 Fixture 재생 시 즉시 시연 가능";
      verifyStatusEl.textContent = "2일 차 대기";
      verifyFormulaEl.textContent = "공식: D - (D-1)";
      return;
    }

    const prev = records[records.length - 2];
    const curr = records[records.length - 1];
    const prevNum = Number(prev.value);
    const currNum = Number(curr.value);
    const diff = currNum - prevNum;
    const sign = diff > 0 ? "+" : "";
    const pct = prevNum !== 0 ? ((diff / prevNum) * 100).toFixed(2) : "0.00";

    prevValEl.textContent = `${prevNum} ${prev.unit}`;
    prevDateEl.textContent = `${prev.dateKST} (${prev.isFixture ? "Fixture" : "실제"})`;

    currValEl.textContent = `${currNum} ${curr.unit}`;
    currDateEl.textContent = `${curr.dateKST} (${curr.isFixture ? "Fixture" : "실제"})`;

    diffValEl.textContent = `${sign}${diff} ${curr.unit}`;
    diffValEl.style.color = diff > 0 ? "#34d399" : diff < 0 ? "#f43f5e" : "#38bdf8";
    diffRateEl.textContent = `${sign}${pct}% (${prev.dateKST} → ${curr.dateKST})`;

    const recalculated = Number(curr.value) - Number(prev.value);
    verifyStatusEl.textContent = recalculated === diff ? "✅ 재계산 일치" : "❌ 불일치";
    verifyFormulaEl.textContent = `${currNum} - ${prevNum} = ${sign}${recalculated}${curr.unit}`;
  }

  function renderConsistencyInspector() {
    if (!state.lastNormal) return;

    document.getElementById("raw-response-json").textContent = JSON.stringify(state.rawExcerpt || {}, null, 2);

    const storedNormal = JSON.parse(localStorage.getItem(STORAGE_KEYS.LAST_NORMAL) || "{}");
    const storedRecords = JSON.parse(localStorage.getItem(STORAGE_KEYS.DAILY_RECORDS) || "[]");
    document.getElementById("stored-value-json").textContent = JSON.stringify(
      {
        lastNormalSummary: {
          value: storedNormal.value,
          unit: storedNormal.unit,
          sourceUrl: storedNormal.sourceUrl,
          sourceTimeKST: storedNormal.sourceTimeKST,
          fetchedTimeKST: storedNormal.fetchedTimeKST,
          dateKST: storedNormal.dateKST
        },
        dailyRecords: storedRecords.map((r) => ({
          dateKST: r.dateKST,
          value: r.value,
          unit: r.unit,
          sourceTimeKST: r.sourceTimeKST,
          sourceUrl: r.sourceUrl
        }))
      },
      null,
      2
    );

    const domValue = Number(document.getElementById("display-value").textContent);
    const domUnit = document.getElementById("display-unit").textContent.trim();
    const domSourceUrl = document.getElementById("display-source-url").textContent.trim();
    const domSourceTime = document.getElementById("display-source-time").textContent.trim();
    const domFetchedTime = document.getElementById("display-fetched-time").textContent.trim();

    const domDailyRows = Array.from(document.querySelectorAll("#daily-records-tbody .daily-record-row")).map((row) => ({
      dateKST: row.querySelector(".cell-date").textContent.trim(),
      value: Number(row.querySelector(".cell-value").textContent.trim()),
      unit: row.querySelector(".cell-unit").textContent.trim(),
      sourceTimeKST: row.querySelector(".cell-time").textContent.trim(),
      sourceUrl: row.querySelector(".cell-url").textContent.trim()
    }));

    document.getElementById("screen-value-json").textContent = JSON.stringify(
      {
        domRendered: {
          value: domValue,
          unit: domUnit,
          sourceUrl: domSourceUrl,
          sourceTimeKST: domSourceTime,
          fetchedTimeKST: domFetchedTime
        },
        domRenderedDailyRecords: domDailyRows,
        freshnessState: state.freshness,
        faultState: state.errorState
      },
      null,
      2
    );
  }

  // ============================================================================
  // 7. 왼쪽 슬라이드 드로어 & 탭 전환 제어
  // ============================================================================
  function openDrawerTab(tabId) {
    const drawer = document.getElementById("side-drawer");

    // 이미 열려 있는 같은 레일 아이콘을 다시 누르면 닫기 토글
    if (state.isDrawerOpen && state.activeDrawerTab === tabId) {
      closeDrawer();
      return;
    }

    state.activeDrawerTab = tabId;
    state.isDrawerOpen = true;
    drawer.classList.add("open");

    document.querySelectorAll(".rail-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-drawer-tab") === tabId);
    });
    document.querySelectorAll(".drawer-tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-drawer-tab") === tabId);
    });
    document.querySelectorAll(".drawer-pane").forEach((pane) => {
      pane.classList.toggle("active", pane.id === tabId);
    });
  }

  function closeDrawer() {
    const drawer = document.getElementById("side-drawer");
    state.isDrawerOpen = false;
    drawer.classList.remove("open");
    document.querySelectorAll(".rail-btn").forEach((btn) => btn.classList.remove("active"));
  }

  function bindEvents() {
    // 왼쪽 레일 버튼 클릭 -> 드로어 열기/토글
    document.querySelectorAll(".rail-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        openDrawerTab(btn.getAttribute("data-drawer-tab"));
      });
    });

    // 드로어 내부 상단 탭 클릭 -> 탭 전환
    document.querySelectorAll(".drawer-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tabId = btn.getAttribute("data-drawer-tab");
        state.activeDrawerTab = tabId;
        document.querySelectorAll(".rail-btn").forEach((b) => {
          b.classList.toggle("active", b.getAttribute("data-drawer-tab") === tabId);
        });
        document.querySelectorAll(".drawer-tab-btn").forEach((b) => {
          b.classList.toggle("active", b.getAttribute("data-drawer-tab") === tabId);
        });
        document.querySelectorAll(".drawer-pane").forEach((pane) => {
          pane.classList.toggle("active", pane.id === tabId);
        });
      });
    });

    // 드로어 닫기 버튼 및 ESC 키
    document.getElementById("btn-close-drawer").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && state.isDrawerOpen) closeDrawer();
    });

    // 실시간 조회 / 재시도 / 복구 Fixture
    document.getElementById("btn-fetch-live").addEventListener("click", () => {
      fetchLiveUSGSData({ isRetry: false });
    });
    document.getElementById("btn-retry-live").addEventListener("click", () => {
      fetchLiveUSGSData({ isRetry: true });
    });
    document.getElementById("btn-replay-recovery").addEventListener("click", replayRecoveryFixture);
    document.getElementById("btn-retry-fixture").addEventListener("click", replayRecoveryFixture);

    // 5가지 합성 실패 재현 버튼
    document.querySelectorAll(".fault-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        triggerSyntheticFault(btn.getAttribute("data-fault"));
      });
    });

    // 같은 날 재조회 덮어쓰기 & Fixture 정리 & JSON 복사
    document.getElementById("btn-test-sameday").addEventListener("click", () => {
      fetchLiveUSGSData({ isRetry: false });
    });
    document.getElementById("btn-clear-fixtures").addEventListener("click", () => {
      state.dailyRecords = state.dailyRecords.filter((r) => !r.isFixture);
      saveStateToStorage();
      renderAll();
    });
    document.getElementById("btn-export-records").addEventListener("click", async () => {
      const jsonStr = JSON.stringify(state.dailyRecords, null, 2);
      try {
        await navigator.clipboard.writeText(jsonStr);
        alert("일별 기록 JSON이 클립보드에 복사되었습니다.");
      } catch (e) {
        prompt("아래 JSON을 복사하세요:", jsonStr);
      }
    });
  }

  async function bootstrap() {
    initWorldMapBase();
    loadPersistedState();

    try {
      const res = await fetch("./data/daily-records.json", { cache: "no-store" });
      if (res.ok) {
        const fileRecords = await res.json();
        if (Array.isArray(fileRecords)) {
          fileRecords.forEach((rec) => {
            if (rec && rec.dateKST && !state.dailyRecords.some((r) => r.dateKST === rec.dateKST)) {
              state.dailyRecords.push(rec);
            }
          });
          state.dailyRecords.sort((a, b) => a.dateKST.localeCompare(b.dateKST));
          saveStateToStorage();
        }
      }
    } catch (_) {}

    bindEvents();
    renderAll();

    await fetchLiveUSGSData({ isRetry: false });
  }

  document.addEventListener("DOMContentLoaded", bootstrap);
})();
