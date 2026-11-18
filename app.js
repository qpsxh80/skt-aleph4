// 과제 4 (T04 오늘의 진짜 정보판): USGS 글로벌 지진 실시간 관제 대시보드
// T04 공개 계약(v2.0.0 / fixture contract v1.1.0) 및 T04-C01 ~ T04-C35 완벽 준수

(function () {
  "use strict";

  const LIVE_SIGNAL_ID = "usgs-all-day-earthquake-count";
  const LIVE_SOURCE_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";
  const LIVE_SOURCE_NAME = "USGS Earthquake Hazards Program";
  const LIVE_UNIT = "건";
  const TIMEZONE_ID = "Asia/Seoul";
  const AUTO_REFRESH_INTERVAL_SEC = 60;

  const STORAGE_KEYS = {
    LIVE_STATE: "usgs_t04_live_state_v2",
    LIVE_QUAKES: "usgs_t04_live_quakes_v2",
    TODAY_ATTEMPTS: "usgs_t04_today_attempts_v2"
  };

  // ============================================================================
  // 1. T04 공식 스키마 및 9개 결정론 Fixture 정본 (T04 폴더 계약 100% 일치)
  // ============================================================================
  const NORMALIZED_KEYS = Object.freeze([
    "signal_id",
    "normalized_value",
    "unit",
    "source_name",
    "source_url",
    "source_time",
    "fetched_at",
    "record_timezone",
    "record_date"
  ]);

  const ERROR_CODES = Object.freeze([
    "timeout",
    "auth",
    "rate_limit",
    "offline",
    "schema_error"
  ]);

  const OFFICIAL_FIXTURES = Object.freeze({
    "T04-NORMAL-D1-A": {
      fixture_id: "T04-NORMAL-D1-A",
      contract_version: "1.1.0",
      description_ko: "가상 1일차 첫 정상 조회: 새 일별 행을 만든다.",
      virtual_now: "2026-08-24T00:00:00.000Z",
      transport: {
        mode: "http",
        status: 200,
        delay_ms: 20,
        deadline_ms: 1500,
        headers: { "content-type": "application/json" }
      },
      payload: {
        signal_id: "aleph-demo-index",
        normalized_value: 100,
        unit: "pt",
        source_name: "ALEPH 결정론 replay",
        source_url: "https://fixtures.aleph.invalid/t04/demo-index",
        source_time: "2026-08-23T23:59:00.000Z",
        fetched_at: "2026-08-24T00:00:00.000Z",
        record_timezone: "Asia/Seoul",
        record_date: "2026-08-24"
      },
      expected: {
        freshness: "fresh",
        error_code: "none",
        row_count: 1,
        stored_value: 100,
        delta: null,
        preserve_last_good: true,
        record_date: "2026-08-24"
      }
    },
    "T04-NORMAL-D1-B": {
      fixture_id: "T04-NORMAL-D1-B",
      contract_version: "1.1.0",
      description_ko: "가상 1일차 두 번째 정상 조회: 새 행 없이 같은 행을 갱신한다.",
      virtual_now: "2026-08-24T09:00:00.000Z",
      transport: {
        mode: "http",
        status: 200,
        delay_ms: 20,
        deadline_ms: 1500,
        headers: { "content-type": "application/json" }
      },
      payload: {
        signal_id: "aleph-demo-index",
        normalized_value: 105,
        unit: "pt",
        source_name: "ALEPH 결정론 replay",
        source_url: "https://fixtures.aleph.invalid/t04/demo-index",
        source_time: null,
        fetched_at: "2026-08-24T09:00:00.000Z",
        record_timezone: "Asia/Seoul",
        record_date: "2026-08-24"
      },
      expected: {
        freshness: "fresh",
        error_code: "none",
        row_count: 1,
        stored_value: 105,
        delta: null,
        preserve_last_good: true,
        same_record_id_as: "T04-NORMAL-D1-A",
        record_date: "2026-08-24"
      }
    },
    "T04-NORMAL-D2": {
      fixture_id: "T04-NORMAL-D2",
      contract_version: "1.1.0",
      description_ko: "가상 2일차 정상 조회: 새 행과 전일 대비 +15를 만든다.",
      virtual_now: "2026-08-25T00:00:00.000Z",
      transport: {
        mode: "http",
        status: 200,
        delay_ms: 20,
        deadline_ms: 1500,
        headers: { "content-type": "application/json" }
      },
      payload: {
        signal_id: "aleph-demo-index",
        normalized_value: 120,
        unit: "pt",
        source_name: "ALEPH 결정론 replay",
        source_url: "https://fixtures.aleph.invalid/t04/demo-index",
        source_time: "2026-08-24T23:59:00.000Z",
        fetched_at: "2026-08-25T00:00:00.000Z",
        record_timezone: "Asia/Seoul",
        record_date: "2026-08-25"
      },
      expected: {
        freshness: "fresh",
        error_code: "none",
        row_count: 2,
        stored_value: 120,
        delta: 15,
        preserve_last_good: true,
        record_date: "2026-08-25"
      }
    },
    "T04-TIMEOUT": {
      fixture_id: "T04-TIMEOUT",
      contract_version: "1.1.0",
      description_ko: "제한시간보다 늦은 응답: 마지막 정상값을 보존하고 timeout을 기록한다.",
      virtual_now: "2026-08-24T10:00:00.000Z",
      transport: {
        mode: "timeout",
        status: null,
        delay_ms: 5000,
        deadline_ms: 1500,
        headers: {}
      },
      payload: null,
      expected: {
        freshness: "stale",
        error_code: "timeout",
        row_count: 1,
        stored_value: 105,
        delta: null,
        preserve_last_good: true
      }
    },
    "T04-AUTH-401": {
      fixture_id: "T04-AUTH-401",
      contract_version: "1.1.0",
      description_ko: "외부 출처가 인증을 거절한 응답: auth를 기록한다.",
      virtual_now: "2026-08-24T10:01:00.000Z",
      transport: {
        mode: "http",
        status: 401,
        delay_ms: 20,
        deadline_ms: 1500,
        headers: { "content-type": "application/json" }
      },
      payload: { message: "unauthorized synthetic fixture" },
      expected: {
        freshness: "stale",
        error_code: "auth",
        row_count: 1,
        stored_value: 105,
        delta: null,
        preserve_last_good: true
      }
    },
    "T04-RATE-429": {
      fixture_id: "T04-RATE-429",
      contract_version: "1.1.0",
      description_ko: "외부 출처의 호출 제한 응답: rate_limit과 Retry-After 관측값을 기록한다.",
      virtual_now: "2026-08-24T10:02:00.000Z",
      transport: {
        mode: "http",
        status: 429,
        delay_ms: 20,
        deadline_ms: 1500,
        headers: { "content-type": "application/json", "retry-after": "60" }
      },
      payload: { message: "rate limited synthetic fixture" },
      expected: {
        freshness: "stale",
        error_code: "rate_limit",
        row_count: 1,
        stored_value: 105,
        delta: null,
        preserve_last_good: true
      }
    },
    "T04-OFFLINE": {
      fixture_id: "T04-OFFLINE",
      contract_version: "1.1.0",
      description_ko: "네트워크 연결 중단: 마지막 정상값을 보존하고 offline을 기록한다.",
      virtual_now: "2026-08-24T10:03:00.000Z",
      transport: {
        mode: "offline",
        status: null,
        delay_ms: 0,
        deadline_ms: 1500,
        headers: {}
      },
      payload: null,
      expected: {
        freshness: "stale",
        error_code: "offline",
        row_count: 1,
        stored_value: 105,
        delta: null,
        preserve_last_good: true
      }
    },
    "T04-SCHEMA-BREAK": {
      fixture_id: "T04-SCHEMA-BREAK",
      contract_version: "1.1.0",
      description_ko: "HTTP 성공이지만 필수값 타입이 바뀐 응답: schema_error를 기록한다.",
      virtual_now: "2026-08-24T10:04:00.000Z",
      transport: {
        mode: "http",
        status: 200,
        delay_ms: 20,
        deadline_ms: 1500,
        headers: { "content-type": "application/json" }
      },
      payload: {
        signal_id: "aleph-demo-index",
        normalized_value: "105",
        unit: "pt",
        source_name: "ALEPH 결정론 replay",
        source_url: "https://fixtures.aleph.invalid/t04/demo-index",
        source_time: null,
        fetched_at: "2026-08-24T10:04:00.000Z",
        record_timezone: "Asia/Seoul",
        record_date: "2026-08-24"
      },
      expected: {
        freshness: "stale",
        error_code: "schema_error",
        row_count: 1,
        stored_value: 105,
        delta: null,
        preserve_last_good: true
      }
    },
    "T04-RECOVER-D2": {
      fixture_id: "T04-RECOVER-D2",
      contract_version: "1.1.0",
      description_ko: "오류 뒤 가상 2일차 재시도 성공: fresh/none으로 회복하고 전일 대비 +15를 만든다.",
      virtual_now: "2026-08-25T00:00:00.000Z",
      transport: {
        mode: "http",
        status: 200,
        delay_ms: 20,
        deadline_ms: 1500,
        headers: { "content-type": "application/json" }
      },
      payload: {
        signal_id: "aleph-demo-index",
        normalized_value: 120,
        unit: "pt",
        source_name: "ALEPH 결정론 replay",
        source_url: "https://fixtures.aleph.invalid/t04/demo-index",
        source_time: "2026-08-24T23:59:00.000Z",
        fetched_at: "2026-08-25T00:00:00.000Z",
        record_timezone: "Asia/Seoul",
        record_date: "2026-08-25"
      },
      expected: {
        freshness: "fresh",
        error_code: "none",
        row_count: 2,
        stored_value: 120,
        delta: 15,
        preserve_last_good: true,
        record_date: "2026-08-25"
      }
    }
  });

  // ============================================================================
  // 2. adapter-reset.example.js 공식 정규화·검증·상태 전이 엔진
  // ============================================================================
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function kstDate(isoString) {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      throw new TypeError("fetched_at must be a valid ISO-8601 date-time");
    }
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  }

  function formatKSTDisplay(isoString) {
    if (!isoString) return "null";
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return String(isoString);
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
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second} KST`;
  }

  function validateNormalizedReading(reading) {
    if (!reading || typeof reading !== "object" || Array.isArray(reading)) {
      throw new TypeError("normalized reading must be an object");
    }
    const actualKeys = Object.keys(reading).sort();
    const expectedKeys = [...NORMALIZED_KEYS].sort();
    if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
      throw new TypeError(`normalized reading keys must be exactly: ${NORMALIZED_KEYS.join(", ")}`);
    }
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(reading.signal_id) || reading.signal_id.length > 100) {
      throw new TypeError("signal_id is invalid");
    }
    if (typeof reading.normalized_value !== "number" || !Number.isFinite(reading.normalized_value)) {
      throw new TypeError("normalized_value must be a finite number");
    }
    for (const field of ["unit", "source_name"]) {
      if (typeof reading[field] !== "string" || reading[field].trim() === "") {
        throw new TypeError(`${field} must be a non-empty string`);
      }
    }
    let sourceUrl;
    try {
      sourceUrl = new URL(reading.source_url);
    } catch {
      throw new TypeError("source_url must be an absolute URL");
    }
    if (sourceUrl.protocol !== "https:") {
      throw new TypeError("source_url must use HTTPS");
    }
    if (reading.source_time !== null && Number.isNaN(new Date(reading.source_time).getTime())) {
      throw new TypeError("source_time must be a valid date-time or null");
    }
    if (Number.isNaN(new Date(reading.fetched_at).getTime())) {
      throw new TypeError("fetched_at must be a valid date-time");
    }
    if (reading.record_timezone !== "Asia/Seoul") {
      throw new TypeError("record_timezone must be Asia/Seoul");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reading.record_date) || reading.record_date !== kstDate(reading.fetched_at)) {
      throw new TypeError("record_date must be the Asia/Seoul date derived from fetched_at");
    }
    return true;
  }

  function validateStatus(status) {
    if (!status || typeof status !== "object" || Array.isArray(status)) return false;
    if (status.freshness === "fresh") return status.error_code === "none";
    if (status.freshness === "stale") return ERROR_CODES.includes(status.error_code);
    return false;
  }

  function resetEvaluationState() {
    return {
      schema_version: "aleph-t04-evaluation-state-v1",
      daily_readings: [],
      current_reading: null,
      status: null,
      last_delta: null,
      last_comparison: {
        state: "insufficient",
        direction: null,
        magnitude: null,
        unit: null
      },
      last_run: null,
      sequence: 0
    };
  }

  function recordIdFor(reading) {
    return `demo-${reading.signal_id}-${reading.record_date}`;
  }

  function comparisonFor(rows, current) {
    const previous = rows
      .filter((row) => row.signal_id === current.signal_id && row.record_date < current.record_date)
      .sort((left, right) => right.record_date.localeCompare(left.record_date))[0];
    if (!previous) {
      return { state: "insufficient", direction: null, magnitude: null, unit: null };
    }
    if (previous.unit !== current.unit) {
      return { state: "unit_mismatch", direction: null, magnitude: null, unit: null };
    }
    const signed = current.normalized_value - previous.normalized_value;
    return {
      state: "comparable",
      direction: signed > 0 ? "increase" : signed < 0 ? "decrease" : "unchanged",
      magnitude: Math.abs(signed),
      signed_delta: signed,
      previous_value: previous.normalized_value,
      previous_date: previous.record_date,
      current_value: current.normalized_value,
      current_date: current.record_date,
      unit: current.unit
    };
  }

  function applySuccessfulReading(inputState, reading, runMeta = {}) {
    validateNormalizedReading(reading);
    const nextState = clone(inputState);
    const existingIndex = nextState.daily_readings.findIndex(
      (row) => row.signal_id === reading.signal_id && row.record_date === reading.record_date
    );
    const existing = existingIndex >= 0 ? nextState.daily_readings[existingIndex] : null;
    const row = {
      record_id: existing ? existing.record_id : recordIdFor(reading),
      signal_id: reading.signal_id,
      record_date: reading.record_date,
      normalized_value: reading.normalized_value,
      unit: reading.unit,
      first_fetched_at: existing ? existing.first_fetched_at : reading.fetched_at,
      last_fetched_at: reading.fetched_at,
      update_count: existing ? (existing.update_count || 1) + 1 : 1,
      reading: clone(reading)
    };

    if (existingIndex >= 0) nextState.daily_readings[existingIndex] = row;
    else nextState.daily_readings.push(row);
    nextState.daily_readings.sort((left, right) => left.record_date.localeCompare(right.record_date));

    nextState.current_reading = clone(reading);
    nextState.status = { freshness: "fresh", error_code: "none" };
    nextState.last_comparison = comparisonFor(nextState.daily_readings, row);
    nextState.last_delta = nextState.last_comparison.magnitude;
    nextState.sequence += 1;
    nextState.last_run = {
      fixture_id: runMeta.fixture_id || null,
      virtual_now: runMeta.virtual_now || reading.fetched_at,
      outcome: "success",
      error_code: "none",
      retry_after_seconds: null
    };
    return nextState;
  }

  function applyError(inputState, errorCode, runMeta = {}) {
    if (!ERROR_CODES.includes(errorCode)) {
      throw new TypeError(`unsupported error code: ${errorCode}`);
    }
    const nextState = clone(inputState);
    nextState.status = { freshness: "stale", error_code: errorCode };
    nextState.sequence += 1;
    nextState.last_run = {
      fixture_id: runMeta.fixture_id || null,
      virtual_now: runMeta.virtual_now || null,
      outcome: "error",
      error_code: errorCode,
      retry_after_seconds: runMeta.retry_after_seconds ?? null
    };
    return nextState;
  }

  function runFixture(inputState, fixture) {
    const meta = {
      fixture_id: fixture.fixture_id,
      virtual_now: fixture.virtual_now,
      retry_after_seconds:
        fixture.transport && fixture.transport.headers && fixture.transport.headers["retry-after"]
          ? Number(fixture.transport.headers["retry-after"])
          : null
    };

    if (fixture.transport.mode === "timeout") return applyError(inputState, "timeout", meta);
    if (fixture.transport.mode === "offline") return applyError(inputState, "offline", meta);
    if (fixture.transport.status === 401 || fixture.transport.status === 403) {
      return applyError(inputState, "auth", meta);
    }
    if (fixture.transport.status === 429) return applyError(inputState, "rate_limit", meta);
    if (fixture.transport.status >= 200 && fixture.transport.status < 300) {
      try {
        return applySuccessfulReading(inputState, fixture.payload, meta);
      } catch {
        return applyError(inputState, "schema_error", meta);
      }
    }
    return applyError(inputState, "schema_error", meta);
  }

  // 전역 T04Adapter 노출 (자동 채점기/콘솔 호환)
  window.T04Adapter = {
    ERROR_CODES,
    NORMALIZED_KEYS,
    OFFICIAL_FIXTURES,
    applyError,
    applySuccessfulReading,
    kstDate,
    resetEvaluationState,
    runFixture,
    validateNormalizedReading,
    validateStatus
  };

  // ============================================================================
  // 3. 런타임 상태 (Live 상태와 합성 Evaluation 상태를 분리 보존)
  // ============================================================================
  const runtime = {
    mode: "live", // 'live' | 'fixture'
    liveState: resetEvaluationState(),
    evalState: resetEvaluationState(),
    quakes: [],
    lastRawExcerpt: null,
    todayAttempts: {},
    activeDrawerTab: "tab-control",
    isDrawerOpen: false,
    // 3D 구체 지구본 회전(rotLon, rotLat) 및 확대(zoomScale) 상태
    rotLon: 138,
    rotLat: 22,
    zoomScale: 1,
    isDraggingMap: false,
    didDragMove: false,
    dragStartX: 0,
    dragStartY: 0,
    selectedQuakeIndex: null,
    autoRefreshRemainingSec: AUTO_REFRESH_INTERVAL_SEC
  };

  function getActiveAdapterState() {
    return runtime.mode === "fixture" ? runtime.evalState : runtime.liveState;
  }

  // ============================================================================
  // 4. 3D 구체 지구본(Orthographic 3D Globe) 투영 & 규모 비례 파동 & 클릭 카드
  // ============================================================================
  const GLOBE_CX = 500;
  const GLOBE_CY = 250;
  const BASE_GLOBE_R = 215;
  const DEG2RAD = Math.PI / 180;

  function getGlobeRadius() {
    return BASE_GLOBE_R * runtime.zoomScale;
  }

  /**
   * 위도·경도를 3D 구체(Orthographic Projection) 화면 좌표 (x, y) 및 가시성(z >= 0)으로 변환합니다.
   */
  function project3D(lon, lat) {
    const R = getGlobeRadius();
    const lam = (Number(lon) || 0) * DEG2RAD;
    const phi = (Number(lat) || 0) * DEG2RAD;
    const lam0 = runtime.rotLon * DEG2RAD;
    const phi0 = runtime.rotLat * DEG2RAD;
    const dLam = lam - lam0;

    const sinPhi0 = Math.sin(phi0);
    const cosPhi0 = Math.cos(phi0);
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const cosDLam = Math.cos(dLam);
    const sinDLam = Math.sin(dLam);

    // z > 0 이면 지구본 앞면(보이는 반구), z < 0 이면 지구 반대편(뒷면)
    const z = sinPhi0 * sinPhi + cosPhi0 * cosPhi * cosDLam;
    const rawX = cosPhi * sinDLam;
    const rawY = cosPhi0 * sinPhi - sinPhi0 * cosPhi * cosDLam;

    let x = GLOBE_CX + R * rawX;
    let y = GLOBE_CY - R * rawY;

    // 지평선(Horizon) 너머의 대륙 꼭짓점이 구체 앞면을 가로지르지 않도록 지평선 원 둘레로 클램핑
    if (z < 0) {
      const len = Math.hypot(rawX, rawY) || 1;
      x = GLOBE_CX + R * (rawX / len);
      y = GLOBE_CY - R * (rawY / len);
    }

    return {
      x: Number(x.toFixed(1)),
      y: Number(y.toFixed(1)),
      z,
      visible: z >= 0
    };
  }

  function initWorldMapBase() {
    // 중심(0%)부터 끝(100%)까지 1% 간격(101개 정지점)으로 진하고 선명하게 퍼지는 방사형 그라데이션 생성
    const redGrad = document.getElementById("impactRedGrad");
    const staleGrad = document.getElementById("impactStaleGrad");
    if (redGrad && staleGrad) {
      let redStops = "";
      let staleStops = "";
      for (let p = 0; p <= 100; p += 1) {
        const t = 1 - p / 100;
        const alpha = Math.pow(t, 0.72).toFixed(4);
        redStops += `<stop offset="${p}%" stop-color="#ff1a32" stop-opacity="${alpha}" />`;
        staleStops += `<stop offset="${p}%" stop-color="#f59e0b" stop-opacity="${alpha}" />`;
      }
      redGrad.innerHTML = redStops;
      staleGrad.innerHTML = staleStops;
    }

    render3DGlobeBase();
  }

  function render3DGlobeBase() {
    const sphereLayer = document.getElementById("map-layer-sphere");
    const clipCircle = document.getElementById("globe-clip-circle");
    const gridLayer = document.getElementById("map-layer-grid");
    const continentLayer = document.getElementById("map-layer-continents");
    const tectonicLayer = document.getElementById("map-layer-tectonic");
    const labelsLayer = document.getElementById("map-layer-labels");
    if (!gridLayer || !continentLayer || !tectonicLayer) return;

    const R = getGlobeRadius();
    const activeState = getActiveAdapterState();
    const isStale = activeState.status && activeState.status.freshness === "stale";

    if (clipCircle) {
      clipCircle.setAttribute("r", String(R.toFixed(1)));
    }

    // 0) 3D 구체 바다 및 대기권 광채(Atmosphere Halo) 렌더링
    if (sphereLayer) {
      const rimColor = isStale ? "rgba(245, 158, 11, 0.75)" : "rgba(56, 189, 248, 0.55)";
      sphereLayer.innerHTML = `
        <circle cx="${GLOBE_CX}" cy="${GLOBE_CY}" r="${(R * 1.12).toFixed(1)}" fill="url(#atmosphereGlow)" pointer-events="none" />
        <circle cx="${GLOBE_CX}" cy="${GLOBE_CY}" r="${R.toFixed(1)}" fill="url(#globeOceanGrad)" stroke="${rimColor}" stroke-width="1.5" />
      `;
    }

    // 1) 3D 구면 경위도 격자선 렌더링
    let gridHtml = "";
    for (let lon = -180; lon < 180; lon += 30) {
      let pathCmd = "";
      for (let lat = -80; lat <= 80; lat += 5) {
        const pt = project3D(lon, lat);
        if (pt.visible) {
          pathCmd += (pathCmd === "" || pathCmd.endsWith(" ") ? "M" : "L") + `${pt.x},${pt.y}`;
        } else if (pathCmd !== "" && !pathCmd.endsWith(" ")) {
          pathCmd += " ";
        }
      }
      if (pathCmd.trim()) {
        gridHtml += `<path d="${pathCmd.trim()}" fill="none" class="map-grid-line" />`;
      }
    }

    for (let lat = -60; lat <= 60; lat += 30) {
      let pathCmd = "";
      for (let lon = -180; lon <= 180; lon += 5) {
        const pt = project3D(lon, lat);
        if (pt.visible) {
          pathCmd += (pathCmd === "" || pathCmd.endsWith(" ") ? "M" : "L") + `${pt.x},${pt.y}`;
        } else if (pathCmd !== "" && !pathCmd.endsWith(" ")) {
          pathCmd += " ";
        }
      }
      if (pathCmd.trim()) {
        const cls = lat === 0 ? "map-equator-line" : "map-grid-line";
        gridHtml += `<path d="${pathCmd.trim()}" fill="none" class="${cls}" />`;
      }
    }
    gridLayer.innerHTML = gridHtml;

    // 2) 3D 구체 위 대륙 폴리곤 렌더링 (뒷면 컬링 포함)
    const mapData = window.WORLD_MAP_DATA || { continents: [], tectonicBelts: [], mapLabels: [] };
    let continentHtml = "";
    mapData.continents.forEach((cont) => {
      let hasVisibleVertex = false;
      const projected = cont.coords.map(([lon, lat]) => {
        const p = project3D(lon, lat);
        if (p.z > -0.08) hasVisibleVertex = true;
        return `${p.x},${p.y}`;
      });
      if (!hasVisibleVertex) return;
      continentHtml += `<polygon points="${projected.join(" ")}" class="map-continent"><title>${cont.name}</title></polygon>`;
    });
    continentLayer.innerHTML = continentHtml;

    // 3) 3D 지진대 가이드라인 렌더링
    let tectonicHtml = "";
    mapData.tectonicBelts.forEach((belt) => {
      let pathCmd = "";
      belt.forEach(([lon, lat]) => {
        const p = project3D(lon, lat);
        if (p.visible) {
          pathCmd += (pathCmd === "" || pathCmd.endsWith(" ") ? "M" : "L") + `${p.x},${p.y}`;
        } else if (pathCmd !== "" && !pathCmd.endsWith(" ")) {
          pathCmd += " ";
        }
      });
      if (pathCmd.trim()) {
        tectonicHtml += `<path d="${pathCmd.trim()}" class="map-tectonic" />`;
      }
    });
    tectonicLayer.innerHTML = tectonicHtml;

    // 4) 가시 반구(z > 0.15) 내 지명 라벨 렌더링
    if (labelsLayer && Array.isArray(mapData.mapLabels)) {
      let labelsHtml = "";
      mapData.mapLabels.forEach((lbl) => {
        const p = project3D(lbl.lon, lbl.lat);
        if (p.z < 0.18) return;
        let fill = "rgba(56, 189, 248, 0.18)";
        if (lbl.type === "fault") fill = "rgba(244, 63, 94, 0.3)";
        if (lbl.type === "country") fill = "rgba(148, 163, 184, 0.42)";
        labelsHtml += `<text x="${p.x}" y="${p.y}" fill="${fill}" font-size="${lbl.size || 8}" font-weight="700" class="map-geo-label">${lbl.text}</text>`;
      });
      labelsLayer.innerHTML = labelsHtml;
    }
  }

  function applyMapZoomTransform() {
    const zoomText = document.getElementById("zoom-level-text");
    if (zoomText) {
      zoomText.textContent = `${runtime.zoomScale.toFixed(1)}x`;
    }
    render3DGlobeBase();
    renderQuakesOnMap();
  }

  function zoomMapAtPoint(newScale) {
    const clampedScale = Math.max(0.8, Math.min(6.0, newScale));
    if (Math.abs(clampedScale - runtime.zoomScale) < 0.001) return;
    runtime.zoomScale = clampedScale;
    applyMapZoomTransform();
  }

  function focusGlobeOnLonLat(lon, lat) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    runtime.rotLon = ((Number(lon) + 180) % 360 + 360) % 360 - 180;
    runtime.rotLat = Math.max(-70, Math.min(70, Number(lat) * 0.65));
  }

  function positionSelectedQuakeCard() {
    const card = document.getElementById("selected-quake-card");
    const svgEl = document.getElementById("world-map-svg");
    const viewportEl = document.getElementById("map-viewport");
    if (!card || !svgEl || !viewportEl) return;

    const quakes = runtime.quakes || [];
    const idx = runtime.selectedQuakeIndex;
    if (idx === null || idx < 0 || idx >= quakes.length) {
      card.style.display = "none";
      return;
    }

    const q = quakes[idx];
    const proj = project3D(q.lon, q.lat);
    if (!proj.visible) {
      card.style.display = "none";
      return;
    }
    card.style.display = "block";

    const svgRect = svgEl.getBoundingClientRect();
    const vpRect = viewportEl.getBoundingClientRect();

    const dotPixelX = svgRect.left - vpRect.left + (proj.x / 1000) * svgRect.width;
    const dotPixelY = svgRect.top - vpRect.top + (proj.y / 500) * svgRect.height;

    const cardWidth = card.offsetWidth || 265;
    const cardHeight = card.offsetHeight || 115;

    let left = dotPixelX + 14;
    let top = dotPixelY - cardHeight / 2;

    if (left + cardWidth > vpRect.width - 14) {
      left = dotPixelX - cardWidth - 14;
    }
    left = Math.max(12, Math.min(vpRect.width - cardWidth - 12, left));
    top = Math.max(12, Math.min(vpRect.height - cardHeight - 12, top));

    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
  }

  /**
   * 진도(규모 M 0 ~ 10)에 따른 통상적인 감진/영향 반경(km)을 계산합니다.
   */
  function computeImpactRadiusKm(mag) {
    const safeMag = Math.max(0, Math.min(10, Number(mag) || 0));
    const km = 5 * Math.pow(10, 0.38 * safeMag);
    return Math.max(5, Math.min(2500, Math.round(km)));
  }

  /**
   * 영향 반경(km)을 3D 지구본(반지름 R, 실제 지구 반지름 6371km) 위 픽셀 반지름으로 변환합니다.
   */
  function computeImpactRadiusPx(mag, scaleFactor) {
    const km = computeImpactRadiusKm(mag);
    const R = getGlobeRadius();
    const geoPx = (km / 6371) * R;
    const minVisualPx = (1.6 + Math.max(0, Number(mag) || 0) * 1.15) * scaleFactor;
    return Math.max(minVisualPx, geoPx);
  }

  /**
   * 진도 0 ~ 10까지 순수 붉은색(Pure Red) 단일 톤을 유지하되,
   * 10으로 갈수록 불투명도(Opacity)와 선명도가 100%에 도달하도록 스타일을 계산합니다.
   */
  function getPureRedStyle(mag, isStale, isSelected) {
    const clampedMag = Math.max(0, Math.min(10, Number(mag) || 0));
    const ratio = clampedMag / 10;
    const intensity = Math.pow(ratio, 0.72);

    const dotAlpha = Number((0.20 + 0.80 * intensity).toFixed(2));
    const strokeAlpha = Number(Math.min(1.0, dotAlpha + 0.18).toFixed(2));
    // 진도별 그라데이션 전체 불투명도를 45% ~ 100% 범위로 강조
    const zoneOpacity = Number((0.45 + 0.55 * intensity).toFixed(2));

    if (isStale && !isSelected) {
      return {
        dotFill: `rgba(245, 158, 11, ${dotAlpha})`,
        dotStroke: `rgba(251, 191, 36, ${strokeAlpha})`,
        zoneGradUrl: "url(#impactStaleGrad)",
        zoneOpacity
      };
    }

    return {
      dotFill: isSelected ? "#ff182c" : `rgba(255, 24, 44, ${dotAlpha})`,
      dotStroke: isSelected ? "#ffffff" : `rgba(255, 65, 82, ${strokeAlpha})`,
      zoneGradUrl: "url(#impactRedGrad)",
      zoneOpacity: isSelected ? 1.0 : zoneOpacity
    };
  }

  function renderSelectedQuakeCard() {
    const card = document.getElementById("selected-quake-card");
    if (!card) return;

    const quakes = runtime.quakes || [];
    const idx = runtime.selectedQuakeIndex;
    if (idx === null || idx < 0 || idx >= quakes.length) {
      card.style.display = "none";
      return;
    }

    const q = quakes[idx];
    const mag = Number(q.mag) || 0;
    const impactKm = computeImpactRadiusKm(mag);
    const redStyle = getPureRedStyle(mag, false, false);
    const magBadge = document.getElementById("sq-mag-badge");
    const typeLabel = document.getElementById("sq-type-label");
    const impactEl = document.getElementById("sq-impact");

    magBadge.textContent = `M ${mag.toFixed(1)}`;
    magBadge.style.background = redStyle.dotFill;
    magBadge.style.color = "#ffffff";
    magBadge.style.borderColor = redStyle.dotStroke;

    typeLabel.textContent = idx === 0 ? "최신 감지 지진" : `이전 지진 기록 (#${idx + 1})`;
    document.getElementById("sq-place").textContent = q.place;
    document.getElementById("sq-coords").textContent = `${Number(q.lat).toFixed(2)}°N, ${Number(q.lon).toFixed(2)}°E`;
    document.getElementById("sq-depth").textContent = `${Number(q.depth).toFixed(1)} km`;
    if (impactEl) {
      impactEl.textContent = `반경 약 ${impactKm.toLocaleString()} km`;
    }
    document.getElementById("sq-time").textContent = formatKSTDisplay(new Date(q.time).toISOString());

    positionSelectedQuakeCard();
  }

  /**
   * 점 크기 계산: 기존 대비 전체적으로 약 20% 키우고(0.2 -> 0.24),
   * 진도(규모, mag)에 따른 크기 차이를 더 뚜렷하게 부각합니다.
   */
  function computeQuakeDotRadius(mag) {
    const safeMag = Math.max(0, Number(mag) || 0);
    const raw = Math.max(1.8, Math.min(13.5, 1.2 + Math.pow(safeMag, 1.35) * 1.35));
    return raw * 0.24;
  }

  /**
   * 3D 구체 표면의 해당 좌표(x, y, z)에서 구의 곡면 기울기에 맞춰
   * 원(점·파동)이 비스듬한 타원 형태로 구 표면에 완전히 밀착되도록 SVG 변환 문자열을 생성합니다.
   */
  function getSurfaceTransform(x, y, z) {
    const dx = x - GLOBE_CX;
    const dy = y - GLOBE_CY;
    const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
    const foreshorten = Math.max(0.16, Math.min(1.0, z));
    return `translate(${x.toFixed(1)}, ${y.toFixed(1)}) rotate(${angleDeg.toFixed(1)}) scale(${foreshorten.toFixed(3)}, 1)`;
  }

  function renderQuakesOnMap() {
    const quakesLayer = document.getElementById("map-layer-quakes");
    const beaconLayer = document.getElementById("map-layer-beacon");
    const calloutLayer = document.getElementById("map-layer-callout");
    if (!quakesLayer || !beaconLayer) return;

    const activeState = getActiveAdapterState();
    const isStale = activeState.status && activeState.status.freshness === "stale";
    const quakes = runtime.quakes || [];
    const scaleFactor = Math.pow(runtime.zoomScale, 0.35);

    if (quakes.length === 0) {
      quakesLayer.innerHTML = "";
      beaconLayer.innerHTML = "";
      if (calloutLayer) calloutLayer.innerHTML = "";
      renderSelectedQuakeCard();
      return;
    }

    // 1) 3D 구체 앞면(visible)에 위치한 이전 지진 점 + 방식 B 상시 통상 영향 반경(붉은 반투명 원) 렌더링
    let dotsHtml = "";
    for (let i = quakes.length - 1; i >= 1; i--) {
      const q = quakes[i];
      const proj = project3D(q.lon, q.lat);
      if (!proj.visible) continue;

      const { x, y, z } = proj;
      const mag = Number(q.mag) || 0;
      const isSelected = runtime.selectedQuakeIndex === i;
      const radius = computeQuakeDotRadius(mag) * scaleFactor;
      const impactPx = computeImpactRadiusPx(mag, scaleFactor);
      const impactKm = computeImpactRadiusKm(mag);
      const hitRadius = Math.max(radius * 2, 9.0);
      const dx = x - GLOBE_CX;
      const dy = y - GLOBE_CY;
      const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
      const foreshorten = Math.max(0.16, Math.min(1.0, z));
      const depthOpacity = isSelected ? 1.0 : Number((0.4 + 0.6 * z).toFixed(2));
      const redStyle = getPureRedStyle(mag, isStale, isSelected);

      dotsHtml += `
        <g class="quake-dot-group" data-quake-index="${i}" transform="translate(${x.toFixed(1)}, ${y.toFixed(1)})" opacity="${depthOpacity}" style="cursor:pointer;">
          <circle cx="0" cy="0" r="${hitRadius.toFixed(2)}" fill="transparent" />
          <g transform="rotate(${angleDeg.toFixed(1)}) scale(${foreshorten.toFixed(3)}, 1)">
            ${
              isSelected
                ? `<circle
                    cx="0"
                    cy="0"
                    r="${impactPx.toFixed(2)}"
                    fill="${redStyle.zoneGradUrl}"
                    fill-opacity="${redStyle.zoneOpacity}"
                    stroke="none"
                    class="quake-impact-zone selected"
                  />`
                : ""
            }
            <circle
              cx="0"
              cy="0"
              r="${radius.toFixed(2)}"
              fill="${redStyle.dotFill}"
              stroke="${redStyle.dotStroke}"
              stroke-width="${(isSelected ? 0.65 : 0.25).toFixed(2)}"
              class="quake-dot ${isSelected ? "selected" : ""}"
            />
          </g>
          <title>[클릭하여 정보 보기] M${mag.toFixed(1)} (영향 반경 약 ${impactKm}km) — ${q.place}</title>
        </g>
      `;
    }
    quakesLayer.innerHTML = dotsHtml;

    quakesLayer.querySelectorAll(".quake-dot-group").forEach((group) => {
      group.addEventListener("click", (e) => {
        e.stopPropagation();
        if (runtime.didDragMove) return;
        const idx = Number(e.currentTarget.getAttribute("data-quake-index"));
        runtime.selectedQuakeIndex = runtime.selectedQuakeIndex === idx ? null : idx;
        renderQuakesOnMap();
      });
    });

    // 2) 최신 지진(quakes[0]) 위치에 단색 코어 점 + 파동 비콘 표시 (클릭 시에만 그라데이션 영향권 표시)
    const newestQuake = quakes[0];
    const newestProj = project3D(newestQuake.lon, newestQuake.lat);
    if (!newestProj.visible) {
      beaconLayer.innerHTML = "";
      if (calloutLayer) calloutLayer.innerHTML = "";
      renderSelectedQuakeCard();
      return;
    }

    const newestMag = Math.max(0.5, Number(newestQuake.mag) || 1.0);
    const newestDotRadius = computeQuakeDotRadius(newestMag) * scaleFactor;
    const newestImpactPx = computeImpactRadiusPx(newestMag, scaleFactor);
    const newestImpactKm = computeImpactRadiusKm(newestMag);
    const isNewestSelected = runtime.selectedQuakeIndex === 0;
    const newestRedStyle = getPureRedStyle(newestMag, isStale, isNewestSelected);
    const pulseMaxR = Math.round((20 + Math.pow(newestMag, 1.55) * 15) * scaleFactor);

    const { x: bx, y: by, z: bz } = newestProj;
    const beaconSurfaceTransform = getSurfaceTransform(bx, by, bz);
    const labelOffsetX = bx > 620 ? -186 : 12;
    const labelOffsetY = by < 70 ? 18 : -12;
    const statusPrefix = isStale ? "[STALE 유지] " : "[NEW 감지] ";

    beaconLayer.innerHTML = `
      <g transform="${beaconSurfaceTransform}" style="--pulse-max-r: ${pulseMaxR}px;">
        ${
          isNewestSelected
            ? `<circle
                cx="0"
                cy="0"
                r="${newestImpactPx.toFixed(2)}"
                fill="${newestRedStyle.zoneGradUrl}"
                fill-opacity="${newestRedStyle.zoneOpacity}"
                stroke="none"
                class="quake-impact-zone selected"
                pointer-events="none"
              />`
            : ""
        }
        <circle cx="0" cy="0" r="1" class="latest-pulse-ring" pointer-events="none" />
        <circle cx="0" cy="0" r="1" class="latest-pulse-ring delay-1" pointer-events="none" />
        <circle cx="0" cy="0" r="1" class="latest-pulse-ring delay-2" pointer-events="none" />
        <circle cx="0" cy="0" r="${newestDotRadius.toFixed(2)}" class="latest-core-beacon" pointer-events="none">
          <title>${statusPrefix}M${Number(newestQuake.mag).toFixed(1)} (영향 반경 약 ${newestImpactKm}km) — ${newestQuake.place}</title>
        </circle>
      </g>
      <circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="10" fill="transparent" id="latest-beacon-hit" style="cursor:pointer;">
        <title>${statusPrefix}M${Number(newestQuake.mag).toFixed(1)} (영향 반경 약 ${newestImpactKm}km) — ${newestQuake.place}</title>
      </circle>
    `;

    if (calloutLayer) {
      calloutLayer.innerHTML = `
        <g transform="translate(${(bx + labelOffsetX).toFixed(1)}, ${(by + labelOffsetY).toFixed(1)})" pointer-events="none">
          <rect x="0" y="-13" width="182" height="30" rx="5" fill="rgba(15, 23, 42, 0.92)" stroke="${isStale ? '#f59e0b' : '#fb7185'}" stroke-width="1.1" />
          <text x="7" y="-1" fill="${isStale ? '#fde68a' : '#fda4af'}" font-size="9" font-weight="bold" font-family="sans-serif">
            ${statusPrefix}M${Number(newestQuake.mag).toFixed(1)} 진앙지
          </text>
          <text x="7" y="10" fill="#e2e8f0" font-size="8" font-family="monospace">
            반경 ~${newestImpactKm}km (${Number(newestQuake.lat).toFixed(1)}°N, ${Number(newestQuake.lon).toFixed(1)}°E)
          </text>
        </g>
      `;
    }

    const latestHit = document.getElementById("latest-beacon-hit");
    if (latestHit) {
      latestHit.addEventListener("click", (e) => {
        e.stopPropagation();
        if (runtime.didDragMove) return;
        runtime.selectedQuakeIndex = runtime.selectedQuakeIndex === 0 ? null : 0;
        renderQuakesOnMap();
      });
    }

    renderSelectedQuakeCard();
  }

  function triggerNewDataArrivalFlash() {
    if (!runtime.quakes || !runtime.quakes.length) return;
    const newest = runtime.quakes[0];

    // 새 지진이 지구본 뒷면에 있으면 해당 진앙지가 정면에 보이도록 지구본 자동 회전
    const checkProj = project3D(newest.lon, newest.lat);
    if (checkProj.z < 0.25) {
      focusGlobeOnLonLat(newest.lon, newest.lat);
      render3DGlobeBase();
      renderQuakesOnMap();
    }

    const beaconLayer = document.getElementById("map-layer-beacon");
    if (!beaconLayer) return;

    const newestMag = Math.max(0.5, Number(newest.mag) || 1.0);
    const maxBurstR = Math.round(28 + Math.pow(newestMag, 1.6) * 18);
    const { x, y, z, visible } = project3D(newest.lon, newest.lat);
    if (!visible) return;

    const flashGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    flashGroup.setAttribute("transform", getSurfaceTransform(x, y, z));
    flashGroup.setAttribute("pointer-events", "none");

    const flashCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    flashCircle.setAttribute("cx", "0");
    flashCircle.setAttribute("cy", "0");
    flashCircle.setAttribute("r", "2");
    flashCircle.setAttribute("fill", "rgba(34, 211, 238, 0.45)");
    flashCircle.setAttribute("stroke", "#ffffff");
    flashCircle.setAttribute("stroke-width", "2.8");
    flashGroup.appendChild(flashCircle);
    beaconLayer.appendChild(flashGroup);

    let r = 2;
    let opacity = 1;
    const step = Math.max(2.5, maxBurstR / 16);
    const timer = setInterval(() => {
      r += step;
      opacity -= 0.065;
      if (opacity <= 0 || r >= maxBurstR) {
        clearInterval(timer);
        flashGroup.remove();
      } else {
        flashCircle.setAttribute("r", String(r.toFixed(1)));
        flashCircle.setAttribute("stroke-opacity", String(opacity));
        flashCircle.setAttribute("fill-opacity", String(opacity * 0.3));
      }
    }, 26);
  }

  // ============================================================================
  // 5. 로컬 저장소 연동 (실제 USGS 일별 기록 영구 보존)
  // ============================================================================
  function loadPersistedLiveState() {
    try {
      const savedLive = localStorage.getItem(STORAGE_KEYS.LIVE_STATE);
      if (savedLive) {
        const parsed = JSON.parse(savedLive);
        if (parsed && Array.isArray(parsed.daily_readings)) {
          runtime.liveState = parsed;
        }
      }
      const savedQuakes = localStorage.getItem(STORAGE_KEYS.LIVE_QUAKES);
      if (savedQuakes) {
        const parsedQ = JSON.parse(savedQuakes);
        if (Array.isArray(parsedQ)) runtime.quakes = parsedQ;
      }
      const savedAttempts = localStorage.getItem(STORAGE_KEYS.TODAY_ATTEMPTS);
      if (savedAttempts) {
        runtime.todayAttempts = JSON.parse(savedAttempts) || {};
      }
    } catch (err) {
      console.warn("localStorage 로드 경고:", err);
    }
  }

  function saveLiveStateToStorage() {
    try {
      localStorage.setItem(STORAGE_KEYS.LIVE_STATE, JSON.stringify(runtime.liveState));
      localStorage.setItem(STORAGE_KEYS.LIVE_QUAKES, JSON.stringify(runtime.quakes));
      localStorage.setItem(STORAGE_KEYS.TODAY_ATTEMPTS, JSON.stringify(runtime.todayAttempts));
    } catch (err) {
      console.warn("localStorage 저장 경고:", err);
    }
  }

  // ============================================================================
  // 6. 실시간 USGS API 호출 (Live Adapter -> applySuccessfulReading)
  // ============================================================================
  async function fetchLiveUSGSData(options = { isAuto: false }) {
    const btnFetch = document.getElementById("btn-fetch-live");
    if (btnFetch) btnFetch.disabled = true;

    try {
      const response = await fetch(LIVE_SOURCE_URL, {
        method: "GET",
        cache: "no-store"
      });

      if (response.status === 401 || response.status === 403) {
        runtime.mode = "live";
        runtime.liveState = applyError(runtime.liveState, "auth", { virtual_now: new Date().toISOString() });
        renderAll();
        return;
      }
      if (response.status === 429) {
        runtime.mode = "live";
        runtime.liveState = applyError(runtime.liveState, "rate_limit", { virtual_now: new Date().toISOString() });
        renderAll();
        return;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const rawData = await response.json();
      if (
        !rawData ||
        !rawData.metadata ||
        typeof rawData.metadata.count !== "number" ||
        !Array.isArray(rawData.features)
      ) {
        runtime.mode = "live";
        runtime.liveState = applyError(runtime.liveState, "schema_error", { virtual_now: new Date().toISOString() });
        renderAll();
        return;
      }

      const fetchedIso = new Date().toISOString();
      const sourceIso = rawData.metadata.generated
        ? new Date(Number(rawData.metadata.generated)).toISOString()
        : null;
      const recordDate = kstDate(fetchedIso);

      // 방식 1-A: 한국 날짜(Asia/Seoul recordDate, 00:00:00 KST 이후)에 발생한 지진만 필터링하여
      // 상단 표시 숫자와 3D 지구본 점 개수를 1:1로 일치시키고 하루 동안 숫자가 줄어들지 않게 함
      const prevTopQuakeId = runtime.quakes.length > 0 ? runtime.quakes[0].id : null;
      const allMappedQuakes = rawData.features.map((f) => {
        const coords = (f.geometry && f.geometry.coordinates) || [0, 0, 0];
        const props = f.properties || {};
        const quakeTimeMs = Number(props.time) || Date.now();
        return {
          id: f.id || "",
          lon: Number(coords[0]) || 0,
          lat: Number(coords[1]) || 0,
          depth: Number(coords[2]) || 0,
          mag: Number(props.mag) || 0,
          place: String(props.place || "Unknown Region"),
          time: quakeTimeMs,
          quakeDateKST: kstDate(new Date(quakeTimeMs).toISOString())
        };
      });

      const todayKSTQuakes = allMappedQuakes.filter((q) => q.quakeDateKST === recordDate);
      runtime.quakes = todayKSTQuakes;

      // 공식 normalized-reading.schema.json 9개 필수 키 생성
      const reading = {
        signal_id: LIVE_SIGNAL_ID,
        normalized_value: todayKSTQuakes.length,
        unit: LIVE_UNIT,
        source_name: LIVE_SOURCE_NAME,
        source_url: LIVE_SOURCE_URL,
        source_time: sourceIso,
        fetched_at: fetchedIso,
        record_timezone: TIMEZONE_ID,
        record_date: recordDate
      };

      runtime.lastRawExcerpt = {
        "metadata.title": rawData.metadata.title,
        "metadata.url": LIVE_SOURCE_URL,
        "metadata.generated": rawData.metadata.generated,
        "metadata.generated_iso": sourceIso,
        "kst_record_date": recordDate,
        "kst_today_earthquake_count": todayKSTQuakes.length,
        "raw_rolling_24h_count": rawData.metadata.count,
        normalizedReading: reading
      };

      // Live 상태에 공식 applySuccessfulReading 적용
      runtime.mode = "live";
      runtime.liveState = applySuccessfulReading(runtime.liveState, reading, {
        fixture_id: null,
        virtual_now: fetchedIso
      });
      runtime.todayAttempts[recordDate] = (Number(runtime.todayAttempts[recordDate]) || 0) + 1;
      runtime.autoRefreshRemainingSec = AUTO_REFRESH_INTERVAL_SEC;

      saveLiveStateToStorage();

      document.querySelectorAll(".fixture-btn").forEach((b) => b.classList.remove("active-fault"));
      renderAll();

      const newTopQuakeId = runtime.quakes.length > 0 ? runtime.quakes[0].id : null;
      if (!options.isAuto || newTopQuakeId !== prevTopQuakeId) {
        triggerNewDataArrivalFlash();
      }
    } catch (err) {
      runtime.mode = "live";
      runtime.liveState = applyError(runtime.liveState, "offline", { virtual_now: new Date().toISOString() });
      renderAll();
    } finally {
      if (btnFetch) btnFetch.disabled = false;
    }
  }

  // ============================================================================
  // 7. T04 공식 9개 결정론 Fixture 실행 및 시퀀스 재생
  // ============================================================================
  function executeOfficialFixture(fixtureId) {
    const fixture = OFFICIAL_FIXTURES[fixtureId];
    if (!fixture) return;

    runtime.mode = "fixture";

    // 실패 Fixture인데 아직 합성 baseline(D1-A -> D1-B)이 없으면 공식 failure_baseline_sequence 자동 선행
    const isFailureFixture = ["T04-TIMEOUT", "T04-AUTH-401", "T04-RATE-429", "T04-OFFLINE", "T04-SCHEMA-BREAK"].includes(fixtureId);
    if (isFailureFixture && !runtime.evalState.current_reading) {
      let s = resetEvaluationState();
      s = runFixture(s, OFFICIAL_FIXTURES["T04-NORMAL-D1-A"]);
      s = runFixture(s, OFFICIAL_FIXTURES["T04-NORMAL-D1-B"]);
      runtime.evalState = s;
    }

    // 복구 Fixture(T04-RECOVER-D2)인데 아직 D1-B / TIMEOUT 선행 상태가 없으면 공식 recovery_sequence 기준점 보장
    if (fixtureId === "T04-RECOVER-D2" && runtime.evalState.daily_readings.length === 0) {
      let s = resetEvaluationState();
      s = runFixture(s, OFFICIAL_FIXTURES["T04-NORMAL-D1-A"]);
      s = runFixture(s, OFFICIAL_FIXTURES["T04-NORMAL-D1-B"]);
      s = runFixture(s, OFFICIAL_FIXTURES["T04-TIMEOUT"]);
      runtime.evalState = s;
    }

    runtime.evalState = runFixture(runtime.evalState, fixture);
    runtime.lastRawExcerpt = fixture;

    document.querySelectorAll(".fixture-btn").forEach((btn) => {
      btn.classList.toggle("active-fault", btn.getAttribute("data-fixture-id") === fixtureId);
    });

    renderAll();

    if (runtime.evalState.status && runtime.evalState.status.freshness === "fresh") {
      triggerNewDataArrivalFlash();
    }
  }

  function runSuccessSequence() {
    runtime.mode = "fixture";
    let s = resetEvaluationState();
    s = runFixture(s, OFFICIAL_FIXTURES["T04-NORMAL-D1-A"]);
    s = runFixture(s, OFFICIAL_FIXTURES["T04-NORMAL-D1-B"]);
    s = runFixture(s, OFFICIAL_FIXTURES["T04-NORMAL-D2"]);
    runtime.evalState = s;
    runtime.lastRawExcerpt = OFFICIAL_FIXTURES["T04-NORMAL-D2"];
    document.querySelectorAll(".fixture-btn").forEach((btn) => {
      btn.classList.toggle("active-fault", btn.getAttribute("data-fixture-id") === "T04-NORMAL-D2");
    });
    renderAll();
    triggerNewDataArrivalFlash();
  }

  function runRecoverySequence() {
    runtime.mode = "fixture";
    let s = resetEvaluationState();
    s = runFixture(s, OFFICIAL_FIXTURES["T04-NORMAL-D1-A"]);
    s = runFixture(s, OFFICIAL_FIXTURES["T04-NORMAL-D1-B"]);
    s = runFixture(s, OFFICIAL_FIXTURES["T04-TIMEOUT"]);
    runtime.evalState = s;
    renderAll();

    setTimeout(() => {
      runtime.evalState = runFixture(runtime.evalState, OFFICIAL_FIXTURES["T04-RECOVER-D2"]);
      runtime.lastRawExcerpt = OFFICIAL_FIXTURES["T04-RECOVER-D2"];
      document.querySelectorAll(".fixture-btn").forEach((btn) => {
        btn.classList.toggle("active-fault", btn.getAttribute("data-fixture-id") === "T04-RECOVER-D2");
      });
      renderAll();
      triggerNewDataArrivalFlash();
    }, 350);
  }

  function handleResetEvaluation() {
    // public-contract.json: "합성 평가 상태만 빈 상태로 되돌린다."
    runtime.evalState = resetEvaluationState();
    runtime.mode = "live";
    document.querySelectorAll(".fixture-btn").forEach((b) => b.classList.remove("active-fault"));
    renderAll();
  }

  // ============================================================================
  // 8. 전체 화면 렌더링
  // ============================================================================
  function renderAll() {
    const activeState = getActiveAdapterState();
    const status = activeState.status || { freshness: "fresh", error_code: "none" };
    const isStale = status.freshness === "stale";
    const reading = activeState.current_reading;

    const appStage = document.getElementById("app-stage");
    const faultCluster = document.getElementById("hud-fault-cluster");
    const badgeFreshness = document.getElementById("badge-freshness");
    const badgeError = document.getElementById("badge-error-state");
    const signalLabel = document.getElementById("hud-signal-label");

    appStage.classList.toggle("is-stale", isStale);
    badgeFreshness.textContent = status.freshness;
    badgeFreshness.className = `freshness-badge ${isStale ? "stale" : "fresh"}`;

    badgeError.textContent = status.error_code;
    badgeError.className = `error-code-badge ${status.error_code !== "none" ? "has-error" : ""}`;

    // 평소(정상 fresh/none)에는 상단 바에서 숨기고, 고장(stale) 발생 시에만 경고 클러스터 노출
    if (faultCluster) {
      faultCluster.style.display = status.error_code === "none" ? "none" : "inline-flex";
    }

    if (reading) {
      if (reading.record_date && /^\d{4}-\d{2}-\d{2}$/.test(reading.record_date)) {
        const [y, m, d] = reading.record_date.split("-");
        signalLabel.textContent =
          reading.signal_id === LIVE_SIGNAL_ID
            ? `${y}년 ${Number(m)}월 ${Number(d)}일 지진`
            : `${y}년 ${Number(m)}월 ${Number(d)}일 (Fixture)`;
      } else {
        signalLabel.textContent = "오늘 지진";
      }
      document.getElementById("display-value").textContent = String(reading.normalized_value);
      document.getElementById("display-unit").textContent = reading.unit;
      document.getElementById("display-source-name").textContent = reading.source_name;
      const urlEl = document.getElementById("display-source-url");
      urlEl.textContent = reading.source_url;
      urlEl.href = reading.source_url;
      document.getElementById("display-source-time").textContent =
        reading.source_time !== null ? reading.source_time : "null (미제공)";
      document.getElementById("display-fetched-time").textContent = reading.fetched_at;
      document.getElementById("display-timezone").textContent = reading.record_timezone;
      document.getElementById("display-record-date").textContent = reading.record_date;
    }

    if (runtime.quakes && runtime.quakes.length > 0) {
      const lq = runtime.quakes[0];
      document.getElementById("display-latest-quake").textContent =
        `M${Number(lq.mag).toFixed(1)} ${lq.place} (${Number(lq.lat).toFixed(2)}°N, ${Number(lq.lon).toFixed(2)}°E)`;
    }

    // 드로어 탭 1 진단 창
    const faultTitle = document.getElementById("fault-Diagnostic-title");
    const faultDesc = document.getElementById("fault-diagnostic-desc");
    const fixtureJsonEl = document.getElementById("fault-fixture-json");

    if (status.error_code === "none") {
      faultTitle.textContent = `✅ 상태: freshness="fresh", error_code="none" (모드: ${runtime.mode.toUpperCase()})`;
      faultTitle.style.color = "#34d399";
      faultDesc.textContent = `현재 일별 행 개수: ${activeState.daily_readings.length}건 / 마지막 정상값: ${reading ? reading.normalized_value : "--"}`;
    } else {
      faultTitle.textContent = `🚨 실패 상태: freshness="stale", error_code="${status.error_code}"`;
      faultTitle.style.color = "#fda4af";
      faultDesc.textContent = `실패 뒤 마지막 정상값(${reading ? reading.normalized_value : "--"})과 일별 행(${activeState.daily_readings.length}건)이 지워지지 않고 유지됩니다.`;
    }

    if (fixtureJsonEl) {
      fixtureJsonEl.textContent = JSON.stringify(
        {
          mode: runtime.mode,
          status: activeState.status,
          row_count: activeState.daily_readings.length,
          stored_value: reading ? reading.normalized_value : null,
          delta: activeState.last_delta,
          last_run: activeState.last_run
        },
        null,
        2
      );
    }

    render3DGlobeBase();
    renderQuakesOnMap();
    renderDailyRecordsTable();
    renderDayOverDayComparison();
    renderConsistencyInspector();
  }

  function renderDailyRecordsTable() {
    const todayKST = kstDate(new Date().toISOString());
    const todayAttemptCount = Number(runtime.todayAttempts[todayKST]) || 0;
    const liveRows = runtime.liveState.daily_readings || [];
    const evalRows = runtime.evalState.daily_readings || [];
    const activeRows = getActiveAdapterState().daily_readings || [];

    const todayRowCount = liveRows.filter((r) => r.record_date === todayKST).length;

    document.getElementById("summary-today-kst").textContent = todayKST;
    document.getElementById("summary-today-attempts").textContent = `${todayAttemptCount}회`;
    document.getElementById("summary-today-rows").textContent = `${todayRowCount}건 유지`;
    document.getElementById("summary-real-records").textContent = String(liveRows.length);
    document.getElementById("summary-fixture-records").textContent = String(evalRows.length);
    document.getElementById("summary-total-records").textContent = String(activeRows.length);

    const tbody = document.getElementById("daily-records-tbody");
    if (activeRows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--text-secondary);">저장된 기록 없음</td></tr>`;
      return;
    }

    tbody.innerHTML = activeRows
      .map((row) => {
        const r = row.reading;
        const isFixtureRow = row.signal_id === "aleph-demo-index";
        const typeBadge = isFixtureRow
          ? `<span style="color:#fbbf24;">Fixture</span>`
          : `<span style="color:#34d399;">실제(Live)</span>`;
        const srcTimeText = r.source_time !== null ? r.source_time : "null";
        return `
          <tr class="daily-record-row">
            <td class="cell-date"><strong style="color:#38bdf8;">${row.record_date}</strong></td>
            <td>${typeBadge}</td>
            <td class="cell-value"><strong>${row.normalized_value}</strong></td>
            <td class="cell-unit">${row.unit}</td>
            <td class="cell-time">${srcTimeText}</td>
            <td class="cell-url"><a href="${r.source_url}" target="_blank" rel="noopener noreferrer">${r.source_url}</a></td>
            <td>${row.update_count || 1}회</td>
          </tr>
        `;
      })
      .join("");
  }

  function renderDayOverDayComparison() {
    const activeState = getActiveAdapterState();
    const rows = activeState.daily_readings || [];
    const liveRows = runtime.liveState.daily_readings || [];
    const pill = document.getElementById("card5-status-pill");

    const prevValEl = document.getElementById("delta-prev-val");
    const prevDateEl = document.getElementById("delta-prev-date");
    const currValEl = document.getElementById("delta-curr-val");
    const currDateEl = document.getElementById("delta-curr-date");
    const diffValEl = document.getElementById("delta-diff-val");
    const diffRateEl = document.getElementById("delta-diff-rate");
    const verifyStatusEl = document.getElementById("delta-verify-status");
    const verifyFormulaEl = document.getElementById("delta-verify-formula");

    if (liveRows.length >= 2) {
      pill.textContent = `✅ 서로 다른 Asia/Seoul 실제 날짜 기록 ${liveRows.length}건 보존 완료 (T04-C22 충족)`;
      pill.style.color = "#34d399";
    } else {
      pill.textContent = `🕒 실제 Asia/Seoul 날짜 기록: 현재 ${liveRows.length}건 (내일 KST 날짜 변경 후 조회 시 2건 완성)`;
      pill.style.color = "#fbbf24";
    }

    if (rows.length < 2) {
      const only = rows[0];
      prevValEl.textContent = only ? `${only.normalized_value} ${only.unit}` : "--";
      prevDateEl.textContent = only ? `record_date: ${only.record_date}` : "--";
      currValEl.textContent = "대기 중";
      currDateEl.textContent = "다음 날짜(D2) 기록 필요";
      diffValEl.textContent = "null";
      diffRateEl.textContent = "state: insufficient (1일차)";
      verifyStatusEl.textContent = "2일차 대기";
      verifyFormulaEl.textContent = "T04-NORMAL-D2 또는 T04-RECOVER-D2 재생 시 +15 pt 즉시 검증";
      return;
    }

    const prev = rows[rows.length - 2];
    const curr = rows[rows.length - 1];
    const signed = curr.normalized_value - prev.normalized_value;
    const magnitude = Math.abs(signed);
    const sign = signed > 0 ? "+" : signed < 0 ? "-" : "";

    prevValEl.textContent = `${prev.normalized_value} ${prev.unit}`;
    prevDateEl.textContent = `record_date: ${prev.record_date}`;

    currValEl.textContent = `${curr.normalized_value} ${curr.unit}`;
    currDateEl.textContent = `record_date: ${curr.record_date}`;

    diffValEl.textContent = `${sign}${magnitude} ${curr.unit}`;
    diffValEl.style.color = signed > 0 ? "#34d399" : signed < 0 ? "#f43f5e" : "#38bdf8";
    diffRateEl.textContent = `direction: ${activeState.last_comparison.direction} / delta(절대값): ${magnitude}`;

    const recalculated = Math.abs(Number(curr.normalized_value) - Number(prev.normalized_value));
    const isMatched = recalculated === activeState.last_delta;
    verifyStatusEl.textContent = isMatched ? "✅ 재계산 100% 일치" : "❌ 불일치";
    verifyFormulaEl.textContent = `|${curr.normalized_value} - ${prev.normalized_value}| = ${recalculated} ${curr.unit}`;
  }

  function renderConsistencyInspector() {
    const activeState = getActiveAdapterState();
    const reading = activeState.current_reading;
    if (!reading) return;

    document.getElementById("raw-response-json").textContent = JSON.stringify(runtime.lastRawExcerpt || {}, null, 2);

    document.getElementById("stored-value-json").textContent = JSON.stringify(
      {
        status: activeState.status,
        current_reading: activeState.current_reading,
        daily_readings: activeState.daily_readings.map((r) => ({
          record_id: r.record_id,
          record_date: r.record_date,
          normalized_value: r.normalized_value,
          unit: r.unit,
          source_time: r.reading.source_time,
          source_url: r.reading.source_url
        }))
      },
      null,
      2
    );

    const domValue = Number(document.getElementById("display-value").textContent);
    const domUnit = document.getElementById("display-unit").textContent.trim();
    const domSourceName = document.getElementById("display-source-name").textContent.trim();
    const domSourceUrl = document.getElementById("display-source-url").textContent.trim();
    const domSourceTime = document.getElementById("display-source-time").textContent.trim();
    const domFetchedTime = document.getElementById("display-fetched-time").textContent.trim();
    const domTimezone = document.getElementById("display-timezone").textContent.trim();
    const domRecordDate = document.getElementById("display-record-date").textContent.trim();

    const domDailyRows = Array.from(document.querySelectorAll("#daily-records-tbody .daily-record-row")).map((row) => ({
      record_date: row.querySelector(".cell-date").textContent.trim(),
      normalized_value: Number(row.querySelector(".cell-value").textContent.trim()),
      unit: row.querySelector(".cell-unit").textContent.trim(),
      source_time: row.querySelector(".cell-time").textContent.trim(),
      source_url: row.querySelector(".cell-url").textContent.trim()
    }));

    document.getElementById("screen-value-json").textContent = JSON.stringify(
      {
        domRenderedReading: {
          normalized_value: domValue,
          unit: domUnit,
          source_name: domSourceName,
          source_url: domSourceUrl,
          source_time: domSourceTime,
          fetched_at: domFetchedTime,
          record_timezone: domTimezone,
          record_date: domRecordDate
        },
        domRenderedDailyRecords: domDailyRows,
        domRenderedStatus: {
          freshness: document.getElementById("badge-freshness").textContent.trim(),
          error_code: document.getElementById("badge-error-state").textContent.trim()
        }
      },
      null,
      2
    );
  }

  // ============================================================================
  // 9. 슬라이드 드로어 제어 및 자동 갱신 타이머
  // ============================================================================
  function openDrawerTab(tabId) {
    const drawer = document.getElementById("side-drawer");
    if (runtime.isDrawerOpen && runtime.activeDrawerTab === tabId) {
      closeDrawer();
      return;
    }
    runtime.activeDrawerTab = tabId;
    runtime.isDrawerOpen = true;
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
    runtime.isDrawerOpen = false;
    drawer.classList.remove("open");
    document.querySelectorAll(".rail-btn").forEach((btn) => btn.classList.remove("active"));
  }

  function startAutoRefreshLoop() {
    setInterval(() => {
      const activeState = getActiveAdapterState();
      const isFreshLive =
        runtime.mode === "live" &&
        activeState.status &&
        activeState.status.freshness === "fresh";

      if (!isFreshLive) return;

      runtime.autoRefreshRemainingSec -= 1;
      if (runtime.autoRefreshRemainingSec <= 0) {
        runtime.autoRefreshRemainingSec = AUTO_REFRESH_INTERVAL_SEC;
        fetchLiveUSGSData({ isAuto: true });
      }
    }, 1000);
  }

  function bindEvents() {
    document.querySelectorAll(".rail-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        openDrawerTab(btn.getAttribute("data-drawer-tab"));
      });
    });

    document.querySelectorAll(".drawer-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tabId = btn.getAttribute("data-drawer-tab");
        runtime.activeDrawerTab = tabId;
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

    document.getElementById("btn-close-drawer").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && runtime.isDrawerOpen) closeDrawer();
    });

    // 3D 지구본 마우스 휠 확대/축소 & 드래그 360° 회전
    const svgEl = document.getElementById("world-map-svg");
    if (svgEl) {
      svgEl.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
          zoomMapAtPoint(runtime.zoomScale * factor);
        },
        { passive: false }
      );

      svgEl.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        runtime.isDraggingMap = true;
        runtime.didDragMove = false;
        runtime.dragStartX = e.clientX;
        runtime.dragStartY = e.clientY;
      });

      window.addEventListener("mousemove", (e) => {
        if (!runtime.isDraggingMap) return;
        const dx = e.clientX - runtime.dragStartX;
        const dy = e.clientY - runtime.dragStartY;
        const moveDist = Math.hypot(dx, dy);
        if (moveDist > 2) runtime.didDragMove = true;

        runtime.dragStartX = e.clientX;
        runtime.dragStartY = e.clientY;

        const sensitivity = 0.28 / Math.pow(runtime.zoomScale, 0.7);
        runtime.rotLon = (((runtime.rotLon - dx * sensitivity) + 180) % 360 + 360) % 360 - 180;
        runtime.rotLat = Math.max(-75, Math.min(75, runtime.rotLat + dy * sensitivity));

        applyMapZoomTransform();
      });

      window.addEventListener("mouseup", () => {
        runtime.isDraggingMap = false;
      });

      svgEl.addEventListener("click", () => {
        if (runtime.didDragMove) return;
        if (runtime.selectedQuakeIndex !== null) {
          runtime.selectedQuakeIndex = null;
          renderQuakesOnMap();
        }
      });
    }

    window.addEventListener("resize", positionSelectedQuakeCard);

    const btnCloseSq = document.getElementById("btn-close-sq");
    if (btnCloseSq) {
      btnCloseSq.addEventListener("click", () => {
        runtime.selectedQuakeIndex = null;
        renderQuakesOnMap();
      });
    }

    document.getElementById("btn-zoom-in").addEventListener("click", () => {
      zoomMapAtPoint(runtime.zoomScale * 1.28);
    });
    document.getElementById("btn-zoom-out").addEventListener("click", () => {
      zoomMapAtPoint(runtime.zoomScale / 1.28);
    });
    document.getElementById("btn-zoom-reset").addEventListener("click", () => {
      runtime.zoomScale = 1;
      if (runtime.quakes && runtime.quakes.length > 0) {
        focusGlobeOnLonLat(runtime.quakes[0].lon, runtime.quakes[0].lat);
      } else {
        runtime.rotLon = 138;
        runtime.rotLat = 22;
      }
      applyMapZoomTransform();
    });

    // 실시간 조회 및 Reset 버튼
    const btnTopFetch = document.getElementById("btn-fetch-live");
    if (btnTopFetch) {
      btnTopFetch.addEventListener("click", () => {
        fetchLiveUSGSData({ isAuto: false });
      });
    }
    document.getElementById("btn-retry-live").addEventListener("click", () => {
      fetchLiveUSGSData({ isAuto: false });
    });
    document.getElementById("btn-reset-eval").addEventListener("click", handleResetEvaluation);
    document.getElementById("btn-clear-fixtures").addEventListener("click", handleResetEvaluation);

    // 상단 다시 시도 버튼 (T04-RECOVER-D2 재생)
    document.getElementById("btn-replay-recovery").addEventListener("click", () => {
      executeOfficialFixture("T04-RECOVER-D2");
    });

    // 공식 9개 개별 Fixture 버튼
    document.querySelectorAll(".fixture-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const fid = btn.getAttribute("data-fixture-id");
        if (fid) executeOfficialFixture(fid);
      });
    });

    // 시퀀스 일괄 재생 버튼
    document.getElementById("btn-seq-success").addEventListener("click", runSuccessSequence);
    document.getElementById("btn-seq-recover").addEventListener("click", runRecoverySequence);

    // 같은 날 재조회 버튼 (T04-C20)
    document.getElementById("btn-test-sameday").addEventListener("click", () => {
      fetchLiveUSGSData({ isAuto: false });
    });

    // JSON 복사
    document.getElementById("btn-export-records").addEventListener("click", async () => {
      const jsonStr = JSON.stringify(getActiveAdapterState().daily_readings, null, 2);
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
    loadPersistedLiveState();

    try {
      const res = await fetch("./data/daily-records.json", { cache: "no-store" });
      if (res.ok) {
        const fileRecords = await res.json();
        if (Array.isArray(fileRecords)) {
          fileRecords.forEach((rec) => {
            if (rec && rec.reading) {
              runtime.liveState = applySuccessfulReading(runtime.liveState, rec.reading);
            }
          });
          saveLiveStateToStorage();
        }
      }
    } catch (_) {}

    bindEvents();
    renderAll();
    startAutoRefreshLoop();

    await fetchLiveUSGSData({ isAuto: false });
  }

  document.addEventListener("DOMContentLoaded", bootstrap);
})();
