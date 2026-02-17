(function () {
  'use strict';

  const MAP_DIV = 'map';
  const PLACEHOLDER_ID = 'mapPlaceholder';

  const ROUTE_COLORS = ['#3388ff', '#22aa44', '#dd4422', '#8844dd', '#dd8800', '#00aaaa', '#aa0088', '#668800'];
  const TRACK_COLORS = ['#e74c3c', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#00bcd4', '#009688'];

  let naverMap = null;
  let kakaoMap = null;
  let naverOverlays = [];
  let kakaoOverlays = [];
  let currentGpxData = null;

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function getProvider() {
    return document.getElementById('mapProvider').value;
  }

  function showPlaceholder(show) {
    const el = document.getElementById(PLACEHOLDER_ID);
    if (el) el.classList.toggle('hidden', !show);
  }

  function loadScript(src, callback) {
    const existing = document.querySelector('script[src*="' + src.split('?')[0] + '"]');
    if (existing) {
      if (callback) callback();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload = callback;
    document.head.appendChild(s);
  }

  function initNaverMap() {
    const clientId = (window.NAVER_CLIENT_ID || '').trim();
    if (!clientId) {
      document.getElementById(PLACEHOLDER_ID).textContent = '네이버 지도: index.html에서 NAVER_CLIENT_ID를 설정하세요.';
      return;
    }
    const url = 'https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=' + encodeURIComponent(clientId);
    loadScript(url, function () {
      if (typeof naver === 'undefined' || !naver.maps) {
        document.getElementById(PLACEHOLDER_ID).textContent = '네이버 지도를 불러올 수 없습니다.';
        return;
      }
      const center = new naver.maps.LatLng(37.5665, 126.978);
      naverMap = new naver.maps.Map(MAP_DIV, {
        center: center,
        zoom: 10,
        mapDataControlOptions: { position: naver.maps.Position.BOTTOM_RIGHT },
        logoControlOptions: { position: naver.maps.Position.BOTTOM_RIGHT }
      });
      showPlaceholder(false);
      if (currentGpxData) redrawMap(false);
    });
  }

  function initKakaoMap() {
    const appKey = (window.KAKAO_APP_KEY || '').trim();
    if (!appKey) {
      document.getElementById(PLACEHOLDER_ID).textContent = '카카오 지도: index.html에서 KAKAO_APP_KEY를 설정하세요.';
      return;
    }
    const url = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + encodeURIComponent(appKey) + '&autoload=false';
    loadScript(url, function () {
      var maps = (window.kakao && window.kakao.maps);
      if (!maps || typeof maps.load !== 'function') {
        document.getElementById(PLACEHOLDER_ID).textContent = '카카오 지도를 불러올 수 없습니다.';
        return;
      }
      maps.load(function () {
        var el = document.getElementById(MAP_DIV);
        var options = {
          center: new maps.LatLng(37.5665, 126.978),
          level: 5
        };
        kakaoMap = new maps.Map(el, options);
        showPlaceholder(false);
        if (currentGpxData) redrawMap(false);
      });
    });
  }

  function clearNaverOverlays() {
    naverOverlays.forEach(function (o) {
      if (o.setMap) o.setMap(null);
    });
    naverOverlays = [];
  }

  function clearKakaoOverlays() {
    kakaoOverlays.forEach(function (o) {
      if (o.setMap) o.setMap(null);
    });
    kakaoOverlays = [];
  }

  function fitBoundsNaver(bounds) {
    if (!naverMap || !bounds) return;
    naverMap.fitBounds(bounds, { padding: 40 });
  }

  function fitBoundsKakao(bounds) {
    if (!kakaoMap || !bounds) return;
    const sw = new kakao.maps.LatLng(bounds.minLat, bounds.minLng);
    const ne = new kakao.maps.LatLng(bounds.maxLat, bounds.maxLng);
    const latlngBounds = new kakao.maps.LatLngBounds(sw, ne);
    kakaoMap.setBounds(latlngBounds, 40, 40, 40, 40);
  }

  function createNaverWptOverlay(position, num, name) {
    var el = document.createElement('div');
    el.className = 'wpt-overlay';
    el.innerHTML = '<span class="wpt-num">' + escapeHtml(String(num)) + '</span><span class="wpt-name">' + escapeHtml(name || '') + '</span>';
    el.style.position = 'absolute';
    el.style.left = '0';
    el.style.top = '0';
    function WptOverlay() {
      this._el = el;
      this._position = position;
      this.setPosition(position);
      this.setMap(naverMap);
    }
    WptOverlay.prototype = new naver.maps.OverlayView();
    WptOverlay.prototype.constructor = WptOverlay;
    WptOverlay.prototype.getPosition = function () { return this._position; };
    WptOverlay.prototype.setPosition = function (pos) { this._position = pos; if (this.draw) this.draw(); };
    WptOverlay.prototype.onAdd = function () { this.getPanes().overlayLayer.appendChild(this._el); };
    WptOverlay.prototype.draw = function () {
      if (!this.getMap()) return;
      var p = this.getProjection().fromCoordToOffset(this.getPosition());
      this._el.style.left = p.x + 'px';
      this._el.style.top = p.y + 'px';
      this._el.style.transform = 'translate(-50%, -100%)';
    };
    WptOverlay.prototype.onRemove = function () { this._el.remove(); };
    return new WptOverlay();
  }

  function drawGpxOnNaver(data, options) {
    options = options || {};
    clearNaverOverlays();
    if (!naverMap || !data) return;
    const allPoints = [];
    const pathToLatLng = function (p) {
      return new naver.maps.LatLng(p.lat, p.lng);
    };

    (data.routes || []).forEach(function (route, idx) {
      if (route.points && route.points.length) {
        const path = route.points.map(pathToLatLng);
        route.points.forEach(function (pt) { allPoints.push(pt); });
        const color = ROUTE_COLORS[idx % ROUTE_COLORS.length];
        const line = new naver.maps.Polyline({ path: path, map: naverMap, strokeColor: color, strokeWeight: 4 });
        naverOverlays.push(line);
      }
    });

    (data.tracks || []).forEach(function (trk, trkIdx) {
      (trk.segments || []).forEach(function (seg) {
        if (seg.points && seg.points.length) {
          const path = seg.points.map(pathToLatLng);
          seg.points.forEach(function (pt) { allPoints.push(pt); });
          const color = TRACK_COLORS[trkIdx % TRACK_COLORS.length];
          const line = new naver.maps.Polyline({
            path: path,
            map: naverMap,
            strokeColor: color,
            strokeWeight: 4,
            strokeStyle: 'shortdash'
          });
          naverOverlays.push(line);
        }
      });
    });

    (data.waypoints || []).forEach(function (wpt, i) {
      allPoints.push({ lat: wpt.lat, lng: wpt.lng });
      var pos = new naver.maps.LatLng(wpt.lat, wpt.lng);
      var overlay = createNaverWptOverlay(pos, i + 1, wpt.name || wpt.desc || '');
      naverOverlays.push(overlay);
    });

    if (options.fitBounds !== false && data.bounds && allPoints.length > 0) {
      const b = data.bounds;
      const bounds = new naver.maps.LatLngBounds(
        new naver.maps.LatLng(b.minLat, b.minLng),
        new naver.maps.LatLng(b.maxLat, b.maxLng)
      );
      fitBoundsNaver(bounds);
    }
  }

  function drawGpxOnKakao(data, options) {
    options = options || {};
    clearKakaoOverlays();
    if (!kakaoMap || !data) return;

    (data.routes || []).forEach(function (route, idx) {
      if (route.points && route.points.length) {
        const path = route.points.map(function (p) {
          return new kakao.maps.LatLng(p.lat, p.lng);
        });
        const color = ROUTE_COLORS[idx % ROUTE_COLORS.length];
        const line = new kakao.maps.Polyline({
          path: path,
          strokeWeight: 4,
          strokeColor: color,
          strokeOpacity: 1
        });
        line.setMap(kakaoMap);
        kakaoOverlays.push(line);
      }
    });

    (data.tracks || []).forEach(function (trk, trkIdx) {
      (trk.segments || []).forEach(function (seg) {
        if (seg.points && seg.points.length) {
          const path = seg.points.map(function (p) {
            return new kakao.maps.LatLng(p.lat, p.lng);
          });
          const color = TRACK_COLORS[trkIdx % TRACK_COLORS.length];
          const line = new kakao.maps.Polyline({
            path: path,
            strokeWeight: 4,
            strokeColor: color,
            strokeOpacity: 1,
            strokeStyle: 'shortdash'
          });
          line.setMap(kakaoMap);
          kakaoOverlays.push(line);
        }
      });
    });

    (data.waypoints || []).forEach(function (wpt, i) {
      var pos = new kakao.maps.LatLng(wpt.lat, wpt.lng);
      var wrapper = document.createElement('div');
      wrapper.className = 'wpt-overlay-wrapper';
      wrapper.style.position = 'absolute';
      wrapper.style.left = '0';
      wrapper.style.top = '0';
      wrapper.style.transform = 'translate(-50%, -100%)';
      var content = document.createElement('div');
      content.className = 'wpt-overlay';
      content.innerHTML = '<span class="wpt-num">' + escapeHtml(String(i + 1)) + '</span><span class="wpt-name">' + escapeHtml(wpt.name || wpt.desc || '') + '</span>';
      wrapper.appendChild(content);
      var overlay = new kakao.maps.CustomOverlay({
        content: wrapper,
        position: pos
      });
      overlay.setMap(kakaoMap);
      kakaoOverlays.push(overlay);
    });

    if (options.fitBounds !== false && data.bounds) {
      fitBoundsKakao(data.bounds);
    }
  }

  function parseGpx(text) {
    if (!text || typeof text !== 'string') return null;
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/xml');
    const gpx = doc.documentElement;
    if (!gpx || gpx.nodeName.toLowerCase() !== 'gpx') return null;

    const ns = gpx.namespaceURI;
    const sel = function (parent, tag) {
      const el = parent.getElementsByTagNameNS(ns, tag)[0] || parent.getElementsByTagName(tag)[0];
      return el ? el.textContent.trim() : '';
    };
    const selNum = function (parent, tag) {
      const s = sel(parent, tag);
      const n = parseFloat(s);
      return isNaN(n) ? null : n;
    };

    const metadata = {};
    const meta = gpx.getElementsByTagNameNS(ns, 'metadata')[0] || gpx.getElementsByTagName('metadata')[0];
    if (meta) {
      metadata.name = sel(meta, 'name');
      metadata.desc = sel(meta, 'desc');
      const author = meta.getElementsByTagNameNS(ns, 'author')[0] || meta.getElementsByTagName('author')[0];
      if (author) metadata.author = sel(author, 'name');
      metadata.time = sel(meta, 'time');
      const bounds = meta.getElementsByTagNameNS(ns, 'bounds')[0] || meta.getElementsByTagName('bounds')[0];
      if (bounds) {
        metadata.bounds = {
          minLat: selNum(bounds, 'minlat') ?? parseFloat(bounds.getAttribute('minlat')),
          minLng: selNum(bounds, 'minlon') ?? parseFloat(bounds.getAttribute('minlon')),
          maxLat: selNum(bounds, 'maxlat') ?? parseFloat(bounds.getAttribute('maxlat')),
          maxLng: selNum(bounds, 'maxlon') ?? parseFloat(bounds.getAttribute('maxlon'))
        };
      }
    }

    const routes = [];
    let rteList = gpx.getElementsByTagNameNS(ns, 'rte');
    if (!rteList.length) rteList = gpx.getElementsByTagName('rte');
    for (let i = 0; i < rteList.length; i++) {
      const rte = rteList[i];
      const points = [];
      let rtepts = rte.getElementsByTagNameNS(ns, 'rtept');
      if (!rtepts.length) rtepts = rte.getElementsByTagName('rtept');
      for (let j = 0; j < rtepts.length; j++) {
        const pt = rtepts[j];
        const lat = parseFloat(pt.getAttribute('lat'));
        const lon = parseFloat(pt.getAttribute('lon'));
        if (!isNaN(lat) && !isNaN(lon)) points.push({ lat: lat, lng: lon });
      }
      routes.push({ name: sel(rte, 'name'), points: points });
    }

    const tracks = [];
    let trkList = gpx.getElementsByTagNameNS(ns, 'trk');
    if (!trkList.length) trkList = gpx.getElementsByTagName('trk');
    for (let i = 0; i < trkList.length; i++) {
      const trk = trkList[i];
      const segments = [];
      let segs = trk.getElementsByTagNameNS(ns, 'trkseg');
      if (!segs.length) segs = trk.getElementsByTagName('trkseg');
      for (let s = 0; s < segs.length; s++) {
        const seg = segs[s];
        const points = [];
        let pts = seg.getElementsByTagNameNS(ns, 'trkpt');
        if (!pts.length) pts = seg.getElementsByTagName('trkpt');
        for (let p = 0; p < pts.length; p++) {
          const pt = pts[p];
          const lat = parseFloat(pt.getAttribute('lat'));
          const lon = parseFloat(pt.getAttribute('lon'));
          if (!isNaN(lat) && !isNaN(lon)) points.push({ lat: lat, lng: lon });
        }
        segments.push({ points: points });
      }
      tracks.push({ name: sel(trk, 'name'), segments: segments });
    }

    const waypoints = [];
    let wptList = gpx.getElementsByTagNameNS(ns, 'wpt');
    if (!wptList.length) wptList = gpx.getElementsByTagName('wpt');
    for (let i = 0; i < wptList.length; i++) {
      const w = wptList[i];
      const lat = parseFloat(w.getAttribute('lat'));
      const lon = parseFloat(w.getAttribute('lon'));
      if (!isNaN(lat) && !isNaN(lon)) {
        waypoints.push({
          lat: lat,
          lng: lon,
          name: sel(w, 'name'),
          desc: sel(w, 'desc'),
          ele: selNum(w, 'ele')
        });
      }
    }

    let bounds = metadata.bounds || null;
    if (!bounds) {
      const all = [];
      routes.forEach(function (r) { r.points.forEach(function (p) { all.push(p); }); });
      tracks.forEach(function (t) {
        t.segments.forEach(function (s) { s.points.forEach(function (p) { all.push(p); }); });
      });
      waypoints.forEach(function (w) { all.push({ lat: w.lat, lng: w.lng }); });
      if (all.length) {
        const lats = all.map(function (p) { return p.lat; });
        const lngs = all.map(function (p) { return p.lng; });
        bounds = {
          minLat: Math.min.apply(null, lats),
          maxLat: Math.max.apply(null, lats),
          minLng: Math.min.apply(null, lngs),
          maxLng: Math.max.apply(null, lngs)
        };
      }
    }

    return {
      metadata: metadata,
      routes: routes,
      tracks: tracks,
      waypoints: waypoints,
      bounds: bounds
    };
  }

  function formatMeta(meta) {
    if (!meta || !Object.keys(meta).length) return '<span class="metadata-empty">(없음)</span>';
    const parts = [];
    if (meta.name) parts.push('<div class="meta-row"><span class="meta-label">이름</span><span class="meta-value">' + escapeHtml(meta.name) + '</span></div>');
    if (meta.desc) parts.push('<div class="meta-row"><span class="meta-label">설명</span><span class="meta-value">' + escapeHtml(meta.desc) + '</span></div>');
    if (meta.author) parts.push('<div class="meta-row"><span class="meta-label">작성자</span><span class="meta-value">' + escapeHtml(meta.author) + '</span></div>');
    if (meta.time) parts.push('<div class="meta-row"><span class="meta-label">시간</span><span class="meta-value">' + escapeHtml(meta.time) + '</span></div>');
    if (meta.bounds) {
      var b = meta.bounds;
      var rangeStr = [b.minLat, b.minLng, b.maxLat, b.maxLng].join(', ');
      parts.push('<div class="meta-row"><span class="meta-label">범위</span><span class="meta-value">' + escapeHtml(rangeStr) + '</span></div>');
    }
    return parts.length ? parts.join('') : '<span class="metadata-empty">(없음)</span>';
  }

  function formatRoutesHtml(routes) {
    if (!routes || !routes.length) return '-';
    var rows = routes.map(function (r, i) {
      var color = ROUTE_COLORS[i % ROUTE_COLORS.length];
      var name = escapeHtml(r.name || '이름 없음');
      var count = r.points ? r.points.length : 0;
      return '<tr><td><input type="checkbox" class="route-check" data-route-index="' + i + '" checked></td><td>' + (i + 1) + '</td><td><span class="color-box color-box-line" style="--line-color:' + color + '"></span></td><td><span class="pan-to-item" data-type="route" data-index="' + i + '">' + name + '</span></td><td>' + count + '</td></tr>';
    }).join('');
    return '<table><thead><tr><th class="th-actions"><input type="checkbox" class="route-check-all" title="전체 선택" checked></th><th>#</th><th></th><th>이름</th><th>포인트</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function formatTracksHtml(tracks) {
    if (!tracks || !tracks.length) return '-';
    var rows = tracks.map(function (t, i) {
      var pts = 0;
      (t.segments || []).forEach(function (s) { pts += (s.points || []).length; });
      var color = TRACK_COLORS[i % TRACK_COLORS.length];
      var name = escapeHtml(t.name || '이름 없음');
      return '<tr><td><input type="checkbox" class="track-check" data-track-index="' + i + '" checked></td><td>' + (i + 1) + '</td><td><span class="color-box color-box-dashed" style="--dash-color:' + color + '"></span></td><td><span class="pan-to-item" data-type="track" data-index="' + i + '">' + name + '</span></td><td>' + pts + '</td></tr>';
    }).join('');
    return '<table><thead><tr><th class="th-actions"><input type="checkbox" class="track-check-all" title="전체 선택" checked></th><th>#</th><th></th><th>이름</th><th>포인트</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function formatWaypointsHtml(wpts) {
    if (!wpts || !wpts.length) return '-';
    var rows = wpts.map(function (w, i) {
      var name = escapeHtml(w.name || w.desc || '—');
      return '<tr><td><input type="checkbox" class="waypoint-check" data-waypoint-index="' + i + '" checked></td><td>' + (i + 1) + '</td><td><span class="pan-to-item" data-type="waypoint" data-index="' + i + '">' + name + '</span></td><td>' + w.lat.toFixed(5) + '</td><td>' + w.lng.toFixed(5) + '</td></tr>';
    }).join('');
    return '<table><thead><tr><th class="th-actions"><input type="checkbox" class="waypoint-check-all" title="전체 선택" checked></th><th>#</th><th>이름</th><th>위도</th><th>경도</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function updateSidebar(data) {
    document.getElementById('metadata').innerHTML = formatMeta(data && data.metadata);
    document.getElementById('routes').innerHTML = formatRoutesHtml(data && data.routes);
    document.getElementById('tracks').innerHTML = formatTracksHtml(data && data.tracks);
    document.getElementById('waypoints').innerHTML = formatWaypointsHtml(data && data.waypoints);
  }

  function getFilteredGpxData() {
    if (!currentGpxData) return null;
    var routeChecks = document.querySelectorAll('#routes .route-check:checked');
    var trackChecks = document.querySelectorAll('#tracks .track-check:checked');
    var wptChecks = document.querySelectorAll('#waypoints .waypoint-check:checked');
    var routeIndices = Array.prototype.map.call(routeChecks, function (el) { return parseInt(el.getAttribute('data-route-index'), 10); });
    var trackIndices = Array.prototype.map.call(trackChecks, function (el) { return parseInt(el.getAttribute('data-track-index'), 10); });
    var wptIndices = Array.prototype.map.call(wptChecks, function (el) { return parseInt(el.getAttribute('data-waypoint-index'), 10); });
    var routes = currentGpxData.routes.filter(function (r, i) { return routeIndices.indexOf(i) >= 0; });
    var tracks = currentGpxData.tracks.filter(function (t, i) { return trackIndices.indexOf(i) >= 0; });
    var waypoints = currentGpxData.waypoints.filter(function (w, i) { return wptIndices.indexOf(i) >= 0; });
    var all = [];
    routes.forEach(function (r) { (r.points || []).forEach(function (p) { all.push(p); }); });
    tracks.forEach(function (t) {
      (t.segments || []).forEach(function (s) { (s.points || []).forEach(function (p) { all.push(p); }); });
    });
    waypoints.forEach(function (w) { all.push({ lat: w.lat, lng: w.lng }); });
    var bounds = null;
    if (all.length) {
      var lats = all.map(function (p) { return p.lat; });
      var lngs = all.map(function (p) { return p.lng; });
      bounds = { minLat: Math.min.apply(null, lats), maxLat: Math.max.apply(null, lats), minLng: Math.min.apply(null, lngs), maxLng: Math.max.apply(null, lngs) };
    }
    return {
      metadata: currentGpxData.metadata,
      routes: routes,
      tracks: tracks,
      waypoints: waypoints,
      bounds: bounds || currentGpxData.bounds
    };
  }

  function redrawMap(skipFitBounds) {
    var data = getFilteredGpxData();
    if (!data) return;
    var opts = { fitBounds: !skipFitBounds };
    if (getProvider() === 'naver' && naverMap) drawGpxOnNaver(data, opts);
    if (getProvider() === 'kakao' && kakaoMap) drawGpxOnKakao(data, opts);
  }

  function onGpxParsed(data) {
    currentGpxData = data;
    updateSidebar(data);
    var main = document.getElementById('main');
    var toggleBtn = document.getElementById('sidebarToggle');
    if (main) main.classList.remove('sidebar-collapsed');
    if (toggleBtn) {
      toggleBtn.classList.remove('is-collapsed');
      toggleBtn.setAttribute('aria-label', '패널 접기');
      toggleBtn.setAttribute('title', '패널 접기');
    }
    redrawMap(false);
    setTimeout(function () {
      if (naverMap && typeof naver !== 'undefined' && naver.maps && naver.maps.Event) {
        naver.maps.Event.trigger(naverMap, 'resize');
      }
      if (kakaoMap && typeof kakao !== 'undefined' && kakao.maps && kakaoMap.relayout) {
        kakaoMap.relayout();
      }
    }, 300);
  }

  function boundsFromPoints(points) {
    if (!points || !points.length) return null;
    var lats = points.map(function (p) { return p.lat; });
    var lngs = points.map(function (p) { return p.lng; });
    return {
      minLat: Math.min.apply(null, lats),
      maxLat: Math.max.apply(null, lats),
      minLng: Math.min.apply(null, lngs),
      maxLng: Math.max.apply(null, lngs)
    };
  }

  function panMapToItem(type, index) {
    if (!currentGpxData) return;
    var b = null;
    if (type === 'route') {
      var route = currentGpxData.routes[index];
      if (!route || !route.points || !route.points.length) return;
      b = boundsFromPoints(route.points);
    } else if (type === 'track') {
      var track = currentGpxData.tracks[index];
      if (!track) return;
      var pts = [];
      (track.segments || []).forEach(function (s) { (s.points || []).forEach(function (p) { pts.push(p); }); });
      if (!pts.length) return;
      b = boundsFromPoints(pts);
    } else if (type === 'waypoint') {
      var wpt = currentGpxData.waypoints[index];
      if (!wpt) return;
      var lat = wpt.lat, lng = wpt.lng;
      if (getProvider() === 'naver' && naverMap) {
        naverMap.setCenter(new naver.maps.LatLng(lat, lng));
        naverMap.setZoom(15, true);
        return;
      }
      if (getProvider() === 'kakao' && kakaoMap) {
        kakaoMap.setCenter(new kakao.maps.LatLng(lat, lng));
        kakaoMap.setLevel(5);
        return;
      }
      return;
    }
    if (!b) return;
    if (getProvider() === 'naver' && naverMap) {
      var bounds = new naver.maps.LatLngBounds(
        new naver.maps.LatLng(b.minLat, b.minLng),
        new naver.maps.LatLng(b.maxLat, b.maxLng)
      );
      fitBoundsNaver(bounds);
    } else if (getProvider() === 'kakao' && kakaoMap) {
      fitBoundsKakao(b);
    }
  }

  function syncRouteHeaderCheckbox() {
    var list = document.querySelectorAll('#routes .route-check');
    var all = list.length;
    var checked = document.querySelectorAll('#routes .route-check:checked').length;
    var header = document.querySelector('#routes .route-check-all');
    if (header) {
      header.checked = all > 0 && checked === all;
      header.indeterminate = checked > 0 && checked < all;
    }
  }

  function syncWaypointHeaderCheckbox() {
    var list = document.querySelectorAll('#waypoints .waypoint-check');
    var all = list.length;
    var checked = document.querySelectorAll('#waypoints .waypoint-check:checked').length;
    var header = document.querySelector('#waypoints .waypoint-check-all');
    if (header) {
      header.checked = all > 0 && checked === all;
      header.indeterminate = checked > 0 && checked < all;
    }
  }

  function syncTrackHeaderCheckbox() {
    var list = document.querySelectorAll('#tracks .track-check');
    var all = list.length;
    var checked = document.querySelectorAll('#tracks .track-check:checked').length;
    var header = document.querySelector('#tracks .track-check-all');
    if (header) {
      header.checked = all > 0 && checked === all;
      header.indeterminate = checked > 0 && checked < all;
    }
  }

  function switchMap() {
    showPlaceholder(true);
    document.getElementById(PLACEHOLDER_ID).textContent = '지도를 불러오는 중…';
    naverMap = null;
    kakaoMap = null;
    clearNaverOverlays();
    clearKakaoOverlays();

    var mapWrap = document.querySelector('.map-wrap');
    var oldMapEl = document.getElementById(MAP_DIV);
    var newMapEl = document.createElement('div');
    newMapEl.id = MAP_DIV;
    newMapEl.className = 'map';
    mapWrap.replaceChild(newMapEl, oldMapEl);

    function initAfterLayout() {
      if (getProvider() === 'naver') {
        initNaverMap();
      } else {
        initKakaoMap();
      }
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(initAfterLayout);
    });
  }

  (function () {
    var providerInput = document.getElementById('mapProvider');
    var toggleBtns = document.querySelectorAll('.map-toggle .toggle-btn');
    toggleBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var provider = btn.getAttribute('data-provider');
        if (!provider || provider === providerInput.value) return;
        providerInput.value = provider;
        toggleBtns.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-provider') === provider); });
        switchMap();
      });
    });
  })();

  document.getElementById('routes').addEventListener('change', function (e) {
    var t = e.target;
    if (t && t.classList.contains('route-check-all')) {
      document.querySelectorAll('#routes .route-check').forEach(function (el) { el.checked = t.checked; });
      redrawMap(true);
    } else if (t && t.classList.contains('route-check')) {
      redrawMap(true);
      syncRouteHeaderCheckbox();
    }
  });
  document.getElementById('tracks').addEventListener('change', function (e) {
    var t = e.target;
    if (t && t.classList.contains('track-check-all')) {
      document.querySelectorAll('#tracks .track-check').forEach(function (el) { el.checked = t.checked; });
      redrawMap(true);
    } else if (t && t.classList.contains('track-check')) {
      redrawMap(true);
      syncTrackHeaderCheckbox();
    }
  });
  document.getElementById('waypoints').addEventListener('change', function (e) {
    var t = e.target;
    if (t && t.classList.contains('waypoint-check-all')) {
      document.querySelectorAll('#waypoints .waypoint-check').forEach(function (el) { el.checked = t.checked; });
      redrawMap(true);
    } else if (t && t.classList.contains('waypoint-check')) {
      redrawMap(true);
      syncWaypointHeaderCheckbox();
    }
  });

  document.querySelector('.sidebar-content').addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('.pan-to-item');
    if (!el) return;
    var type = el.getAttribute('data-type');
    var index = el.getAttribute('data-index');
    if (type && index !== null && index !== undefined) panMapToItem(type, parseInt(index, 10));
  });

  (function () {
    var main = document.getElementById('main');
    var toggleBtn = document.getElementById('sidebarToggle');
    if (!main || !toggleBtn) return;
    function triggerMapResize() {
      setTimeout(function () {
        if (naverMap && typeof naver !== 'undefined' && naver.maps && naver.maps.Event) {
          naver.maps.Event.trigger(naverMap, 'resize');
        }
        if (kakaoMap && typeof kakao !== 'undefined' && kakao.maps && kakaoMap.relayout) {
          kakaoMap.relayout();
        }
      }, 250);
    }
    function updateA11y() {
      var collapsed = main.classList.contains('sidebar-collapsed');
      toggleBtn.classList.toggle('is-collapsed', collapsed);
      toggleBtn.setAttribute('aria-label', collapsed ? '패널 펼치기' : '패널 접기');
      toggleBtn.setAttribute('title', collapsed ? '패널 펼치기' : '패널 접기');
    }
    toggleBtn.addEventListener('click', function () {
      main.classList.toggle('sidebar-collapsed');
      updateA11y();
      triggerMapResize();
    });
    updateA11y();
  })();

  document.getElementById('gpxFile').addEventListener('change', function (e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (ev) {
      const text = ev.target && ev.target.result;
      if (!text) return;
      const data = parseGpx(text);
      if (data) {
        onGpxParsed(data);
      } else {
        updateSidebar(null);
        document.getElementById('metadata').innerHTML = '<span class="metadata-error">GPX 파싱 실패. 올바른 GPX 파일인지 확인하세요.</span>';
      }
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  });

  if (getProvider() === 'naver') {
    initNaverMap();
  } else {
    initKakaoMap();
  }
})();
