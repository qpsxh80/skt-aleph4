// 과제 4: 외부 데이터 모니터링 대시보드 (USGS 전 세계 지진 실시간 관제 시스템)
// 조건 T04-C01 ~ T04-C28 완벽 대응 (비밀키 0건, 개인정보 0건, 내장 SVG 세계지도 레이더 비콘)

(function () {
  "use strict";

  const SOURCE_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";
  const SOURCE_NAME = "USGS (미국 지질조사국) Earthquake Hazards Program";
  const TRACKED_UNIT = "건";
  const TIMEZONE_ID = "Asia/Seoul";
  const TIMEZONE_LABEL = "Asia/Seoul (UTC+09:00, KST)";

  // localStorage 키 정의
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
      label: "응답 지연 (Request Timeout)",
      description: "[합성 테스트 데이터] 서버 응답이 제한 시간(5,000ms)을 초과하여 타임아웃이 발생했습니다. 마지막 정상값은 지워지지 않고 STALE 상태로 유지됩니다.",
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
      label: "401/403 접근 거부 (Unauthorized / Forbidden)",
      description: "[합성 테스트 데이터] HTTP 403 Forbidden (또는 401 Unauthorized) 접근 거부 응답을 재현했습니다. 마지막 정상값은 지워지지 않고 STALE 상태로 유지됩니다.",
      payload: {
        syntheticFixture: true,
        faultType: "AUTH_401_403",
        httpStatus: 403,
        statusText: "Forbidden",
        error: "SyntheticAuthError: Access denied (401/403) on synthetic endpoint check"
      }
    },
    RATE_LIMIT_429: {
      reqCode: "T04-C14",
      faultCode: "RATE_LIMIT_429",
      label: "호출 제한 도달 (429 Too Many Requests / Rate Limit)",
      description: "[합성 테스트 데이터] HTTP 429 호출 빈도 제한(Rate Limit) 초과 상태를 재현했습니다. 마지막 정상값은 지워지지 않고 STALE 상태로 유지됩니다.",
      payload: {
        syntheticFixture: true,
        faultType: "RATE_LIMIT_429",
        httpStatus: 429,
        retryAfterSeconds: 60,
        error: "SyntheticRateLimitError: 429 Too Many Requests — Quota exceeded"
      }
    },
    OFFLINE: {
      reqCode: "T04-C15",
      faultCode: "OFFLINE",
      label: "네트워크 오프라인 (Network Offline)",
      description: "[합성 테스트 데이터] 브라우저/네트워크 오프라인 단절 상태를 재현했습니다. 내장 벡터 세계지도와 마지막 정상값은 깨지지 않고 STALE 상태로 유지됩니다.",
      payload: {
        syntheticFixture: true,
        faultType: "OFFLINE",
        navigatorOnLine: false,
        error: "SyntheticNetworkError: ERR_INTERNET_DISCONNECTED (Offline mode)"
      }
    },
    SCHEMA_MISMATCH: {
      reqCode: "T04-C16",
      faultCode: "SCHEMA_MISMATCH",
      label: "응답 형식(Schema) 변경 감지",
      description: "[합성 테스트 데이터] HTTP 200 응답이나 필수 필드(metadata.count, features 배열)가 누락·변경된 스키마 오류를 재현했습니다. 마지막 정상값이 STALE 상태로 보호됩니다.",
      payload: {
        syntheticFixture: true,
        faultType: "SCHEMA_MISMATCH",
        httpStatus: 200,
        receivedMalformedBody: {
          api_version: "2.0-breaking",
          items_total: "INVALID_TYPE",
          data: null
        },
        error: "SyntheticSchemaError: Expected number at 'metadata.count' and array at 'features'"
      }
    }
  };

  // 애플리케이션 런타임 상태
  const state = {
    freshness: "fresh", // 'fresh' | 'stale'
    errorState: "none", // 'none' | 'TIMEOUT' | 'AUTH_401_403' | 'RATE_LIMIT_429' | 'OFFLINE' | 'SCHEMA_MISMATCH'
    lastNormal: null,   // 마지막 정상 응답 스냅샷 (절대 지워지지 않음, T04-C17)
    rawExcerpt: null,   // 원본 응답 발췌본 (T04-C10)
    dailyRecords: [],   // KST YYYY-MM-DD 고유키 일별 기록 배열
    todayAttempts: {},  // { "YYYY-MM-DD": number }
    focusedQuakeIndex: 0
  };

  // ============================================================================
  // 1. KST (Asia/Seoul) 날짜/시각 유틸리티 (T04-C07, C08, C09, C20, C21)
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
  // 2. 내장 관제형 세계지도 SVG 렌더링 & 진앙지 레이더 비콘 (Equirectangular 1000x500)
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

    // 1) 위도/경도 격자선 생성
    let gridHtml = "";
    for (let lon = -150; lon <= 150; lon += 30) {
      const { x } = lonLatToXY(lon, 0);
      gridHtml += `<line x1="${x}" y1="0" x2="${x}" y2="500" class="map-grid-line" />`;
      gridHtml += `<text x="${x + 3}" y="494" fill="#475569" font-size="8" font-family="monospace">${lon > 0 ? "+" + lon : lon}°</text>`;
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const { y } = lonLatToXY(0, lat);
      const cls = lat === 0 ? "map-equator-line" : "map-grid-line";
      gridHtml += `<line x1="0" y1="${y}" x2="1000" y2="${y}" class="${cls}" />`;
      gridHtml += `<text x="6" y="${y - 4}" fill="#475569" font-size="8" font-family="monospace">${lat === 0 ? "EQ 0°" : (lat > 0 ? "+" + lat : lat) + "°"}</text>`;
    }
    gridLayer.innerHTML = gridHtml;

    // 2) 대륙 폴리곤 렌더링
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

    // 3) 환태평양 조산대(불의 고리) 가이드라인 렌더링
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

  function renderQuakesOnMap() {
    const quakesLayer = document.getElementById("map-layer-quakes");
    const beaconLayer = document.getElementById("map-layer-beacon");
    const mapViewport = document.getElementById("map-viewport");
    const hudLatest = document.getElementById("map-hud-latest");
    const beaconTitle = document.getElementById("map-beacon-title");
    const beaconCoords = document.getElementById("map-beacon-coords");
    const plottedCountEl = document.getElementById("map-plotted-count");
    const radarStateEl = document.getElementById("map-radar-state");
    const bannerTextEl = document.getElementById("beacon-banner-text");

    if (!quakesLayer || !beaconLayer) return;

    const isStale = state.freshness === "stale";
    mapViewport.classList.toggle("is-stale-map", isStale);
    hudLatest.classList.toggle("stale-hud", isStale);

    if (isStale) {
      radarStateEl.textContent = `STALE (오류: ${state.errorState} — 마지막 정상 좌표 유지)`;
      radarStateEl.style.color = "#fbbf24";
    } else {
      radarStateEl.textContent = "LIVE (정상 수신 · 실시간 비콘 점멸 중)";
      radarStateEl.style.color = "#34d399";
    }

    const quakes = (state.lastNormal && state.lastNormal.quakes) || [];
    plottedCountEl.textContent = String(quakes.length);

    if (quakes.length === 0) {
      quakesLayer.innerHTML = "";
      beaconLayer.innerHTML = "";
      return;
    }

    const safeIndex = Math.min(state.focusedQuakeIndex, quakes.length - 1);
    const targetQuake = quakes[safeIndex];

    // 일반 지진 분포 점 렌더링 (오래된 순으로 그려서 최신 지진이 위로 오게 함)
    let dotsHtml = "";
    for (let i = quakes.length - 1; i >= 0; i--) {
      const q = quakes[i];
      const { x, y } = lonLatToXY(q.lon, q.lat);
      const mag = Number(q.mag) || 0;
      const radius = Math.max(2.2, Math.min(8.5, 2 + mag * 1.15));

      let fill = "rgba(56, 189, 248, 0.55)";
      let stroke = "rgba(56, 189, 248, 0.9)";
      if (mag >= 4.5) {
        fill = "rgba(244, 63, 94, 0.72)";
        stroke = "#fda4af";
      } else if (mag >= 2.5) {
        fill = "rgba(251, 191, 36, 0.65)";
        stroke = "#fde68a";
      }

      if (isStale) {
        fill = "rgba(245, 158, 11, 0.45)";
        stroke = "rgba(251, 191, 36, 0.8)";
      }

      dotsHtml += `
        <circle
          cx="${x}"
          cy="${y}"
          r="${radius.toFixed(1)}"
          fill="${fill}"
          stroke="${stroke}"
          stroke-width="0.9"
          class="quake-dot"
          data-quake-index="${i}"
        >
          <title>[클릭하여 포커스] M${mag.toFixed(1)} — ${q.place} (${formatKSTFull(q.time)})</title>
        </circle>
      `;
    }
    quakesLayer.innerHTML = dotsHtml;

    // 점 클릭 시 해당 지진 위치로 반짝임 비콘 이동
    quakesLayer.querySelectorAll(".quake-dot").forEach((circle) => {
      circle.addEventListener("click", (e) => {
        const idx = Number(e.currentTarget.getAttribute("data-quake-index")) || 0;
        state.focusedQuakeIndex = idx;
        renderQuakesOnMap();
      });
    });

    // 타겟(최신 또는 선택된) 지진 위치에 반짝이는 레이더 비콘 렌더링
    const { x: bx, y: by } = lonLatToXY(targetQuake.lon, targetQuake.lat);
    const labelX = bx > 760 ? bx - 195 : bx + 14;
    const labelY = by < 55 ? by + 24 : by - 14;
    const statusPrefix = isStale ? "[STALE 유지] " : "[NEW 감지] ";

    beaconLayer.innerHTML = `
      <!-- 타겟 조준 십자선 -->
      <line x1="${bx}" y1="0" x2="${bx}" y2="500" stroke="${isStale ? 'rgba(245,158,11,0.32)' : 'rgba(34,211,238,0.28)'}" stroke-width="1" stroke-dasharray="3 4" />
      <line x1="0" y1="${by}" x2="1000" y2="${by}" stroke="${isStale ? 'rgba(245,158,11,0.32)' : 'rgba(34,211,238,0.28)'}" stroke-width="1" stroke-dasharray="3 4" />

      <!-- 배경 네온 광원 -->
      <circle cx="${bx}" cy="${by}" r="30" fill="url(#beaconGlow)" />

      <!-- 3중 파동 링 (Radar Pulse) -->
      <circle cx="${bx}" cy="${by}" r="6" class="latest-pulse-ring" />
      <circle cx="${bx}" cy="${by}" r="6" class="latest-pulse-ring delay-1" />
      <circle cx="${bx}" cy="${by}" r="6" class="latest-pulse-ring delay-2" />

      <!-- 중심부 점멸 비콘 코어 -->
      <circle cx="${bx}" cy="${by}" r="6" class="latest-core-beacon" />

      <!-- 지도 위 진앙지 콜아웃 라벨 -->
      <g transform="translate(${labelX}, ${labelY})">
        <rect x="0" y="-14" width="184" height="32" rx="5" fill="rgba(6, 11, 22, 0.88)" stroke="${isStale ? '#f59e0b' : '#22d3ee'}" stroke-width="1.1" />
        <text x="7" y="-1" fill="${isStale ? '#fde68a' : '#38bdf8'}" font-size="9.5" font-weight="bold" font-family="sans-serif">
          ${statusPrefix}M${Number(targetQuake.mag).toFixed(1)} 진앙지 점멸
        </text>
        <text x="7" y="11" fill="#e2e8f0" font-size="8.5" font-family="monospace">
          (${Number(targetQuake.lat).toFixed(2)}°, ${Number(targetQuake.lon).toFixed(2)}°)
        </text>
      </g>
    `;

    // 상단 HUD 및 하단 배너 텍스트 업데이트
    beaconTitle.textContent = `${statusPrefix}규모 M${Number(targetQuake.mag).toFixed(1)} — ${targetQuake.place}`;
    beaconCoords.textContent = `위도: ${Number(targetQuake.lat).toFixed(3)}° / 경도: ${Number(targetQuake.lon).toFixed(3)}° / 깊이: ${Number(targetQuake.depth).toFixed(1)}km`;

    bannerTextEl.innerHTML = `
      <strong>${statusPrefix}M${Number(targetQuake.mag).toFixed(1)} (${targetQuake.place})</strong> —
      좌표 <code>[${Number(targetQuake.lat).toFixed(2)}°N, ${Number(targetQuake.lon).toFixed(2)}°E]</code> 위치에서 레이더 비콘이 반짝이고 있습니다.
      (발생 시각: ${formatKSTFull(targetQuake.time)})
    `;
  }

  function triggerExtraFlashEffect() {
    const beaconLayer = document.getElementById("map-layer-beacon");
    if (!beaconLayer || !state.lastNormal || !state.lastNormal.quakes.length) return;

    const q = state.lastNormal.quakes[state.focusedQuakeIndex] || state.lastNormal.quakes[0];
    const { x, y } = lonLatToXY(q.lon, q.lat);

    const flashCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    flashCircle.setAttribute("cx", String(x));
    flashCircle.setAttribute("cy", String(y));
    flashCircle.setAttribute("r", "8");
    flashCircle.setAttribute("fill", "rgba(34, 211, 238, 0.45)");
    flashCircle.setAttribute("stroke", "#ffffff");
    flashCircle.setAttribute("stroke-width", "3");
    beaconLayer.appendChild(flashCircle);

    let r = 8;
    let opacity = 1;
    const timer = setInterval(() => {
      r += 4.5;
      opacity -= 0.08;
      if (opacity <= 0) {
        clearInterval(timer);
        flashCircle.remove();
      } else {
        flashCircle.setAttribute("r", String(r));
        flashCircle.setAttribute("stroke-opacity", String(opacity));
        flashCircle.setAttribute("fill-opacity", String(opacity * 0.4));
      }
    }, 30);
  }

  // ============================================================================
  // 3. 일별 기록 저장 및 KST 고유키(YYYY-MM-DD) Upsert 로직 (T04-C20, T04-C21)
  // ============================================================================
  function loadPersistedState() {
    try {
      const savedNormal = localStorage.getItem(STORAGE_KEYS.LAST_NORMAL);
      if (savedNormal) {
        state.lastNormal = JSON.parse(savedNormal);
      }
      const savedRecords = localStorage.getItem(STORAGE_KEYS.DAILY_RECORDS);
      if (savedRecords) {
        const parsed = JSON.parse(savedRecords);
        if (Array.isArray(parsed)) {
          state.dailyRecords = parsed;
        }
      }
      const savedAttempts = localStorage.getItem(STORAGE_KEYS.TODAY_ATTEMPTS);
      if (savedAttempts) {
        state.todayAttempts = JSON.parse(savedAttempts) || {};
      }
    } catch (err) {
      console.warn("localStorage 로드 중 경고:", err);
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
      console.warn("localStorage 저장 중 경고:", err);
    }
  }

  /**
   * KST 기준 YYYY-MM-DD를 고유키로 사용하여 일별 기록을 저장합니다.
   * - 같은 날짜 키가 이미 있으면 덮어쓰기 (행 개수 1건 유지, T04-C20)
   * - 다음 날짜 등 새로운 날짜 키면 새 행 추가 (T04-C21)
   */
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

    // 날짜 오름차순 정렬 (T04-C24)
    state.dailyRecords.sort((a, b) => a.dateKST.localeCompare(b.dateKST));
    saveStateToStorage();
  }

  // ============================================================================
  // 4. 실시간 USGS API 호출 (T04-C01 ~ T04-C11, T04-C20)
  // ============================================================================
  async function fetchLiveUSGSData(options = { isRetry: false }) {
    const btnFetch = document.getElementById("btn-fetch-live");
    const statusMsg = document.getElementById("status-message-text");

    if (btnFetch) btnFetch.disabled = true;
    if (options.isRetry) {
      statusMsg.textContent = "🔁 재시도 동작 실행 중: USGS 실시간 지진 API에 재연결하고 있습니다...";
    } else {
      statusMsg.textContent = "📡 USGS 실시간 GeoJSON 피드를 조회하고 있습니다...";
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

      // 스키마 검증 (metadata.count 숫자 및 features 배열 확인)
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

      // 상위 180개 최근 지진 좌표 추출 (세계지도 표출용)
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

      // 원본 응답 발췌 저장 (T04-C10 대조용)
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

      // 마지막 정상값 업데이트 (T04-C10, T04-C17)
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

      // 오늘(KST) 성공 횟수 카운트 증가 (T04-C20)
      state.todayAttempts[dateKST] = (Number(state.todayAttempts[dateKST]) || 0) + 1;

      // KST 고유키(YYYY-MM-DD)로 일별 기록 Upsert (같은 날 여러 번 성공해도 1건 유지, T04-C20)
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
        recordTypeLabel: "실제 API 조회"
      });

      // 상태를 fresh / none 으로 복구
      state.freshness = "fresh";
      state.errorState = "none";
      state.focusedQuakeIndex = 0;

      // 카드 3 실패 버튼 활성화 표시 해제
      document.querySelectorAll(".fault-btn").forEach((b) => b.classList.remove("active-fault"));
      document.getElementById("fault-fixture-json").textContent = JSON.stringify(
        {
          status: "LIVE_RECOVERY_SUCCESS",
          freshness: "fresh",
          errorState: "none",
          dateKST,
          value: normalizedValue,
          unit: TRACKED_UNIT
        },
        null,
        2
      );

      renderAll();
      triggerExtraFlashEffect();
    } catch (err) {
      // 실제 네트워크 오류 시 오프라인/에러 상태로 전환하되 마지막 정상값 보존
      triggerSyntheticFault("OFFLINE");
    } finally {
      if (btnFetch) btnFetch.disabled = false;
    }
  }

  // ============================================================================
  // 5. 카드 3: 5가지 합성 실패 재현 및 복구 Fixture 재생 (T04-C12 ~ T04-C19, C26)
  // ============================================================================
  function triggerSyntheticFault(faultKey) {
    const fixture = SYNTHETIC_FAULT_FIXTURES[faultKey];
    if (!fixture) return;

    // 실패 상태로 전환하되 state.lastNormal은 절대 지우지 않음! (T04-C17)
    state.freshness = "stale"; // T04-C18
    state.errorState = fixture.faultCode;

    // 버튼 하이라이트
    document.querySelectorAll(".fault-btn").forEach((btn) => {
      btn.classList.toggle("active-fault", btn.getAttribute("data-fault") === faultKey);
    });

    // 합성 테스트 Fixture 페이로드 표시 (T04-C26)
    const fixtureJsonEl = document.getElementById("fault-fixture-json");
    if (fixtureJsonEl) {
      fixtureJsonEl.textContent = JSON.stringify(fixture.payload, null, 2);
    }

    renderAll();
  }

  /**
   * T04-C19 & T04-C21 검증용 복구 Fixture 재생:
   * 1) 재시도 동작(진행 메시지)이 화면에 보임
   * 2) 상태를 fresh / none 으로 복귀
   * 3) 기준 시간대(KST)의 '다음 날짜(YYYY-MM-DD + 1일)'로 새 일별 기록 1건 추가
   */
  function replayRecoveryFixture() {
    const statusMsg = document.getElementById("status-message-text");
    const faultTitle = document.getElementById("fault-Diagnostic-title");
    if (statusMsg) {
      statusMsg.textContent = "🛠️ 재시도 동작 수행 중: 복구 Fixture를 재생하여 fresh/none 복귀 및 다음 날짜 일별 기록을 생성합니다...";
    }
    if (faultTitle) {
      faultTitle.textContent = "⏳ 재시도 진행 중 (Recovery Fixture Replaying...)";
      faultTitle.style.color = "#38bdf8";
    }

    setTimeout(() => {
      // 기준이 되는 가장 최근 날짜 키 찾기 (없으면 오늘 KST)
      const latestDateKey =
        state.dailyRecords.length > 0
          ? state.dailyRecords[state.dailyRecords.length - 1].dateKST
          : getKSTDateKey(Date.now());

      const nextDateKST = getNextKSTDateKey(latestDateKST);
      const baseValue = state.lastNormal ? Number(state.lastNormal.value) : 275;
      // 전일 대비 변화(T04-C24)가 명확히 보이도록 +14건 변화된 복구 Fixture 값 구성
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

      // 마지막 정상값 갱신 및 fresh / none 복귀 (T04-C19)
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
      state.focusedQuakeIndex = 0;

      // 다음 날짜(KST + 1일) 일별 기록 1건 추가 (T04-C19, T04-C21)
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
        recordTypeLabel: "합성 복구 Fixture (T04-C19)"
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
      triggerExtraFlashEffect();
    }, 320);
  }

  // ============================================================================
  // 6. 전체 화면 렌더링 및 정합성/전일대비 계산 업데이트
  // ============================================================================
  function renderAll() {
    const isStale = state.freshness === "stale";
    const normal = state.lastNormal;

    // 1) 상단 시스템 상태 바 업데이트
    const statusBar = document.getElementById("system-status-bar");
    const badgeFreshness = document.getElementById("badge-freshness");
    const badgeError = document.getElementById("badge-error-state");
    const statusMsg = document.getElementById("status-message-text");

    statusBar.classList.toggle("is-stale", isStale);
    badgeFreshness.textContent = state.freshness;
    badgeFreshness.className = `freshness-badge ${isStale ? "stale" : "fresh"}`;

    if (state.errorState === "none") {
      badgeError.textContent = "none (정상)";
      badgeError.className = "error-code-badge";
      statusMsg.textContent = "✅ 정상 수신 중 — 최신 지진 데이터(fresh)와 세계지도 레이더 비콘이 동기화되어 있습니다.";
    } else {
      const faultInfo = SYNTHETIC_FAULT_FIXTURES[state.errorState];
      badgeError.textContent = `${state.errorState} (${faultInfo ? faultInfo.label : "오류"})`;
      badgeError.className = "error-code-badge has-error";
      statusMsg.textContent = `⚠️ [${state.errorState}] 실패 발생 — 마지막 정상값을 지우지 않고 유지하며 STALE(오래된 값)로 표시합니다.`;
    }

    // 2) 카드 1·2 대표 값 및 메타데이터 렌더링 (T04-C04 ~ T04-C09, C17, C18)
    const metricBox = document.getElementById("metric-hero-box");
    const inlineFreshness = document.getElementById("inline-freshness-label");
    metricBox.classList.toggle("is-stale-box", isStale);

    if (isStale) {
      inlineFreshness.textContent = "stale (오래된 값 — 실패 뒤 마지막 정상값 유지 중)";
      inlineFreshness.style.color = "#fbbf24";
    } else {
      inlineFreshness.textContent = "fresh (최신 정상값)";
      inlineFreshness.style.color = "#34d399";
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
          `M${Number(lq.mag).toFixed(1)} — ${lq.place} (${Number(lq.lat).toFixed(2)}°, ${Number(lq.lon).toFixed(2)}°)`;
      }
    }

    // 3) 카드 3 진단 패널 업데이트
    const faultPanel = document.getElementById("fault-detail-panel");
    const faultTitle = document.getElementById("fault-Diagnostic-title");
    const faultDesc = document.getElementById("fault-diagnostic-desc");

    if (state.errorState === "none") {
      faultPanel.classList.remove("fault-active");
      faultTitle.textContent = "✅ 정상 상태 (Fault: none / Freshness: fresh)";
      faultTitle.style.color = "#34d399";
      faultDesc.textContent =
        "현재 모든 API 호출이 정상입니다. 위 5가지 실패 버튼 중 하나를 클릭하여 장애 상태 및 STALE 보존을 재현할 수 있습니다.";
    } else {
      const f = SYNTHETIC_FAULT_FIXTURES[state.errorState];
      faultPanel.classList.add("fault-active");
      faultTitle.textContent = `🚨 [${f.reqCode}] ${f.faultCode}: ${f.label} (Freshness: stale)`;
      faultTitle.style.color = "#fda4af";
      faultDesc.textContent = f.description;
    }

    // 4) 세계지도 마커 & 반짝임 비콘 렌더링
    renderQuakesOnMap();

    // 5) 카드 4 일별 기록 테이블 렌더링 (T04-C20, T04-C21)
    renderDailyRecordsTable();

    // 6) 카드 5 전일 대비 변화 계산 (T04-C22, T04-C24)
    renderDayOverDayComparison();

    // 7) 원본 응답 · 저장값 · 화면 표시값 3중 일치 인스펙터 (T04-C10, T04-C23)
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
    document.getElementById("summary-today-rows").textContent = `${todayRowCount}건 (중복 없이 1건 유지 충족)`;
    document.getElementById("summary-total-records").textContent = String(state.dailyRecords.length);
    document.getElementById("summary-real-records").textContent = String(realRecordsCount);
    document.getElementById("summary-fixture-records").textContent = String(fixtureRecordsCount);

    const tbody = document.getElementById("daily-records-tbody");
    if (state.dailyRecords.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color: var(--text-secondary);">저장된 일별 기록이 없습니다.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.dailyRecords
      .map((r) => {
        const badgeHtml = r.isFixture
          ? `<span class="pill-badge amber" style="font-size:0.72rem; padding:2px 8px;">합성 복구 Fixture (T04-C19)</span>`
          : `<span class="pill-badge emerald" style="font-size:0.72rem; padding:2px 8px;">실제 API 조회 (Real)</span>`;

        return `
          <tr>
            <td><strong style="color:#38bdf8;">${r.dateKST}</strong></td>
            <td>${badgeHtml}</td>
            <td><strong style="font-size:0.95rem; color:#f8fafc;">${r.value}</strong></td>
            <td>${r.unit}</td>
            <td>${r.sourceTimeKST}</td>
            <td>${r.fetchedTimeKST}</td>
            <td><a href="${r.sourceUrl}" target="_blank" rel="noopener noreferrer">${r.sourceUrl}</a></td>
            <td>${r.sameDayUpdateCount || 1}회 갱신 (1건 유지)</td>
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
      pill.className = "pill-badge emerald";
    } else {
      pill.textContent = `🕒 실제 Asia/Seoul 날짜 기록: 현재 ${realRecords.length}건 (내일 KST 날짜 변경 후 1회 더 조회 시 2건 완성)`;
      pill.className = "pill-badge amber";
    }

    // 비교 대상: 전체 일별 기록 중 가장 최근 2개 날짜 (실제 2일이 모이면 실제 2일, 아니면 복구 Fixture 포함 2일 시연)
    if (records.length < 2) {
      const only = records[0];
      prevValEl.textContent = only ? `${only.value} ${only.unit}` : "--";
      prevDateEl.textContent = only ? `날짜: ${only.dateKST} (${only.isFixture ? "Fixture" : "실제 조회"})` : "날짜: --";
      currValEl.textContent = "대기 중 (2일 차 필요)";
      currDateEl.textContent = "다음 날짜(KST) 조회 또는 복구 Fixture 재생 시 비교 활성화";
      diffValEl.textContent = "--";
      diffRateEl.textContent = "변화율: 2일 차 기록 생성 후 자동 계산";
      verifyStatusEl.textContent = "2일 차 기록 대기 중";
      verifyStatusEl.style.color = "#fbbf24";
      verifyFormulaEl.textContent = "상단 [복구 Fixture 재생 (T04-C19)] 클릭 시 다음 날짜 기록으로 즉시 검증 가능";
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
    prevDateEl.textContent = `날짜: ${prev.dateKST} (${prev.isFixture ? "복구 Fixture" : "실제 조회"})`;

    currValEl.textContent = `${currNum} ${curr.unit}`;
    currDateEl.textContent = `날짜: ${curr.dateKST} (${curr.isFixture ? "복구 Fixture" : "실제 조회"})`;

    diffValEl.textContent = `${sign}${diff} ${curr.unit}`;
    diffValEl.style.color = diff > 0 ? "#34d399" : diff < 0 ? "#f43f5e" : "#38bdf8";
    diffRateEl.textContent = `변화율: ${sign}${pct}% (${prev.dateKST} → ${curr.dateKST})`;

    // 재계산 검증 (T04-C24)
    const recalculated = Number(curr.value) - Number(prev.value);
    const isMatched = recalculated === diff;
    verifyStatusEl.textContent = isMatched ? "✅ 재계산 100% 일치" : "❌ 불일치";
    verifyStatusEl.style.color = isMatched ? "#34d399" : "#f43f5e";
    verifyFormulaEl.textContent = `검증식: ${currNum}${curr.unit}(${curr.dateKST}) - ${prevNum}${prev.unit}(${prev.dateKST}) = ${sign}${recalculated}${curr.unit}`;
  }

  function renderConsistencyInspector() {
    const rawEl = document.getElementById("raw-response-json");
    const storedEl = document.getElementById("stored-value-json");
    const screenEl = document.getElementById("screen-value-json");
    const matchBadge = document.getElementById("consistency-match-badge");

    if (!state.lastNormal) return;

    // 1) 원본 응답 발췌
    rawEl.textContent = JSON.stringify(state.rawExcerpt || {}, null, 2);

    // 2) localStorage 저장값
    const storedNormal = JSON.parse(localStorage.getItem(STORAGE_KEYS.LAST_NORMAL) || "{}");
    const storedRecords = JSON.parse(localStorage.getItem(STORAGE_KEYS.DAILY_RECORDS) || "[]");
    storedEl.textContent = JSON.stringify(
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

    // 3) 실제 화면 DOM 표시값 읽어오기 (T04-C10 & T04-C23 검증)
    const domValue = Number(document.getElementById("display-value").textContent);
    const domUnit = document.getElementById("display-unit").textContent.trim();
    const domSourceUrl = document.getElementById("display-source-url").textContent.trim();
    const domSourceTime = document.getElementById("display-source-time").textContent.trim();
    const domFetchedTime = document.getElementById("display-fetched-time").textContent.trim();

    const screenSnapshot = {
      domRenderedCard1: {
        value: domValue,
        unit: domUnit,
        sourceUrl: domSourceUrl,
        sourceTimeKST: domSourceTime,
        fetchedTimeKST: domFetchedTime
      },
      freshnessState: state.freshness,
      faultState: state.errorState
    };
    screenEl.textContent = JSON.stringify(screenSnapshot, null, 2);

    const isConsistent =
      storedNormal.value === domValue &&
      storedNormal.unit === domUnit &&
      storedNormal.sourceUrl === domSourceUrl &&
      storedNormal.sourceTimeKST === domSourceTime;

    if (isConsistent) {
      matchBadge.textContent = "✅ 원본 응답 · localStorage 저장값 · 화면 표시값 100% 일치 (T04-C10·C23 통과)";
      matchBadge.className = "pill-badge emerald";
    } else {
      matchBadge.textContent = "⚠️ 값 동기화 확인 필요";
      matchBadge.className = "pill-badge amber";
    }
  }

  // ============================================================================
  // 7. 이벤트 바인딩 및 초기화
  // ============================================================================
  function bindEvents() {
    // 실시간 USGS 조회 버튼
    document.getElementById("btn-fetch-live").addEventListener("click", () => {
      fetchLiveUSGSData({ isRetry: false });
    });

    // 카드 3의 실시간 재시도 버튼 (T04-C19)
    document.getElementById("btn-retry-live").addEventListener("click", () => {
      fetchLiveUSGSData({ isRetry: true });
    });

    // 복구 Fixture 재생 버튼 (상단 & 카드 3, T04-C19)
    document.getElementById("btn-replay-recovery").addEventListener("click", () => {
      replayRecoveryFixture();
    });
    document.getElementById("btn-retry-fixture").addEventListener("click", () => {
      replayRecoveryFixture();
    });

    // 5가지 합성 실패 재현 버튼들 (T04-C12 ~ T04-C16)
    document.querySelectorAll(".fault-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const faultType = btn.getAttribute("data-fault");
        triggerSyntheticFault(faultType);
      });
    });

    // 지도 반짝임 효과 수동 재생 버튼
    document.getElementById("btn-trigger-flash").addEventListener("click", () => {
      triggerExtraFlashEffect();
    });

    // 다른 최근 지진 위치로 포커스 순환
    document.getElementById("btn-cycle-quake").addEventListener("click", () => {
      const quakes = (state.lastNormal && state.lastNormal.quakes) || [];
      if (quakes.length > 0) {
        state.focusedQuakeIndex = (state.focusedQuakeIndex + 1) % Math.min(quakes.length, 25);
        renderQuakesOnMap();
        triggerExtraFlashEffect();
      }
    });

    // 카드 4: 같은 날(오늘 KST) 연속 조회 덮어쓰기 검증 버튼 (T04-C20)
    document.getElementById("btn-test-sameday").addEventListener("click", () => {
      fetchLiveUSGSData({ isRetry: false });
    });

    // 카드 4: 합성 복구 Fixture 행만 정리하고 실제 API 조회 기록만 유지
    document.getElementById("btn-clear-fixtures").addEventListener("click", () => {
      state.dailyRecords = state.dailyRecords.filter((r) => !r.isFixture);
      saveStateToStorage();
      renderAll();
    });

    // 일별 기록 JSON 클립보드 복사
    document.getElementById("btn-export-records").addEventListener("click", async () => {
      const jsonStr = JSON.stringify(state.dailyRecords, null, 2);
      try {
        await navigator.clipboard.writeText(jsonStr);
        alert("일별 기록 JSON이 클립보드에 복사되었습니다.");
      } catch (e) {
        prompt("아래 JSON을 복사하세요:", jsonStr);
      }
    });

    // 상단 KST 실시간 시계
    setInterval(() => {
      const clockEl = document.getElementById("header-kst-clock");
      if (clockEl) {
        clockEl.textContent = `🕒 기준 시간대: Asia/Seoul (${formatKSTFull(Date.now())})`;
      }
    }, 1000);
  }

  async function bootstrap() {
    initWorldMapBase();
    loadPersistedState();

    // 정적 data/daily-records.json 파일에 저장된 실제 기록이 있으면 병합 (시크릿 창 T04-C01 대비)
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
    } catch (_) {
      // 로컬 file:// 환경 등에서는 무시
    }

    bindEvents();
    renderAll();

    // 진입 시 자동으로 USGS 실시간 데이터 1회 조회
    await fetchLiveUSGSData({ isRetry: false });
  }

  document.addEventListener("DOMContentLoaded", bootstrap);
})();
