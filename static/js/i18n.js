/* StormMap — Ukrainian interface (EN / УКР). Translates DOM text, titles and placeholders in place,
 * including content rendered later (MutationObserver). Meteorological abbreviations stay as-is.
 * Translations are a first pass — corrections from native-speaking forecasters are welcome. */
'use strict';

(function () {
  const UK = {
    // top bar / rail
    'Region': 'Регіон', 'Model': 'Модель', 'Search city…': 'Пошук міста…', 'Search city': 'Пошук міста',
    'Model data': 'Дані моделі', 'Radar': 'Радар', 'Radar mosaic': 'Радарна мозаїка', 'Lightning': 'Блискавки',
    'Lightning feed': 'Потік блискавок', 'Tracker': 'Трекер', 'Cell tracker': 'Трекер комірок', 'Zones': 'Зони',
    'No-go zones': 'Заборонені зони', 'Air-raid': 'Тривога', 'Air-raid alerts': 'Повітряні тривоги',
    'Units & settings': 'Одиниці та налаштування', 'Settings': 'Налаштування', 'Layers': 'Шари',
    'Layers & parameters': 'Шари та параметри', 'Ranking': 'Рейтинг', 'Storm potential ranking': 'Рейтинг потенціалу гроз',
    'Outlook': 'Прогноз', 'Convective outlook & chase targets': 'Конвективний прогноз і цілі',
    'Warnings': 'Попередження', 'Official warnings': 'Офіційні попередження', 'Chase': 'Погоня', 'About': 'Довідка',
    'About & data sources': 'Довідка та джерела даних', 'Collapse panel': 'Згорнути панель',
    'OFFLINE': 'ОФЛАЙН', 'No connection — showing cached data': 'Немає зв’язку — показано збережені дані',
    // layers pane
    'Model field': 'Поле моделі', 'Opacity': 'Прозорість', 'Wind animation': 'Анімація вітру',
    'Values at cities': 'Значення в містах', 'Model difference': 'Різниця моделей', 'Off': 'Вимк.',
    'Isolines': 'Ізолінії', 'Auto': 'Авто', 'Isobars (MSLP)': 'Ізобари (тиск на рівні моря)',
    '500 hPa height': 'Висота 500 гПа', 'None': 'Немає', 'Wind barbs': 'Вітрові стрілки',
    'Lightning (live)': 'Блискавки (наживо)', 'Storm cells & tracks': 'Грозові комірки та треки',
    'Satellite': 'Супутник', 'Water vapour 6.2': 'Водяна пара 6.2', 'Outlook categories': 'Категорії прогнозу',
    'No-go zones (occupied UA)': 'Заборонені зони (окуповані території)',
    'Air-raid alerts (UA oblasts)': 'Повітряні тривоги (області)', 'Mine-contamination areas': 'Можливо заміновані території',
    'Surface observations (METAR)': 'Наземні спостереження (METAR)', 'Road network': 'Дорожня мережа',
    'Base map': 'Підкладка', 'Dark': 'Темна', 'Terrain': 'Рельєф', 'Roads': 'Дороги', 'Imagery': 'Знімки',
    'Model parameter': 'Параметр моделі', 'Save this area offline': 'Зберегти район для офлайну',
    'Store map tiles and safety layers for this view so the app keeps working without signal': 'Зберегти тайли карти та шари безпеки для цього виду, щоб застосунок працював без зв’язку',
    'Offline mode needs HTTPS (or localhost).': 'Офлайн-режим потребує HTTPS (або localhost).',
    // tracker / ranking
    'Live storm tracker': 'Трекер гроз наживо', 'Threshold': 'Поріг', 'Frames': 'Кадри', 'Rescan': 'Оновити',
    'Waiting for radar…': 'Очікування радара…', 'Storm ranking': 'Рейтинг гроз', 'All cells': 'Усі комірки',
    'Chaseable only': 'Лише доступні', 'Locate': 'Показати', 'Plan intercept': 'Перехоплення',
    'Plan road intercept': 'Маршрут перехоплення', 'Issue warning': 'Попередити',
    'HIGH POTENTIAL': 'ВИСОКИЙ ПОТЕНЦІАЛ', 'GOOD POTENTIAL': 'ДОБРИЙ ПОТЕНЦІАЛ', 'MARGINAL': 'ПОМІРНИЙ',
    'NO POTENTIAL': 'БЕЗ ПОТЕНЦІАЛУ', 'DYING': 'ЗГАСАЄ', '⛔ Not chaseable': '⛔ Недоступна для погоні',
    'not chaseable': 'недоступна', 'motion unknown': 'рух невідомий',
    'Motion unknown (new cell)': 'Рух невідомий (нова комірка)',
    'No intercept possible at this speed': 'Перехоплення неможливе на цій швидкості',
    'Every tracked cell scored 0–100 for chase potential: core intensity, trend, lightning, the model environment along its forecast path and persistence. Cells heading into no-go zones are marked not chaseable.':
      'Кожна комірка оцінюється від 0 до 100: інтенсивність ядра, тенденція, блискавки, середовище моделі вздовж прогнозного шляху та тривалість життя. Комірки, що прямують у заборонені зони, позначено як недоступні.',
    // outlook
    'Convective outlook': 'Конвективний прогноз', 'Automated guidance from': 'Автоматична оцінка за моделлю',
    'Generate chase briefing': 'Згенерувати брифінг', 'Copy': 'Копіювати', 'Countries': 'Країни',
    'Chase targets': 'Цілі для погоні', 'Today': 'Сьогодні',
    // warnings pane
    'Air-raid alerts · Ukraine': 'Повітряні тривоги · Україна', 'StormMap storm warnings': 'Штормові попередження StormMap',
    'Official weather warnings': 'Офіційні метеопопередження', 'MeteoAlarm feeds of the national weather services.': 'Стрічки MeteoAlarm національних метеослужб.',
    'Convective': 'Конвективні', 'All types': 'Усі типи', 'Feed status': 'Стан стрічок',
    'No active air-raid alerts.': 'Активних повітряних тривог немає.', 'Whole oblast': 'Уся область',
    'No active StormMap warnings.': 'Активних попереджень StormMap немає.', 'Cancel': 'Скасувати',
    'Live air-raid alerts need a free alerts.in.ua token (ALERTS_IN_UA_TOKEN).': 'Для тривог наживо потрібен безкоштовний токен alerts.in.ua (ALERTS_IN_UA_TOKEN).',
    // warning composer
    'Issue storm warning': 'Видати штормове попередження', 'review everything before publishing': 'перевірте все перед публікацією',
    'Valid': 'Діє', 'Severity': 'Рівень', 'Moderate': 'Помірний', 'Severe': 'Сильний', 'Extreme': 'Екстремальний',
    'Regenerate text': 'Оновити текст', 'Rebuild the texts from the current settings': 'Перебудувати тексти за поточними налаштуваннями',
    'In the path (Kyiv time):': 'На шляху (київський час):', 'Admin token': 'Токен адміністратора', 'Publish': 'Опублікувати',
    // chase pane
    'Chase mode': 'Режим погоні', 'Track my GPS': 'Стежити за GPS', 'Stop GPS': 'Зупинити GPS',
    'Set position on map': 'Вказати позицію на карті', 'Road speed': 'Швидкість на дорозі', 'Safe flank': 'Безпечний фланг',
    'On track': 'На треку', 'Route to point': 'Маршрут до точки',
    "Target the storm's right/south-east flank, away from the hail core": 'Ціль — правий (південно-східний) фланг грози, подалі від ядра граду',
    "Target the storm's forecast position": 'Ціль — прогнозна позиція грози',
    'Front-line buffer': 'Буфер від лінії фронту', 'Border zone (UA–RU/BY)': 'Прикордонна зона (UA–RU/BY)',
    'Routes never enter occupied or contested territory or the buffers above, and never cross Ukraine’s closed borders with Russia, Belarus and Transnistria, or the closed Türkiye–Armenia border. Ukraine–Moldova crossings elsewhere stay open. Always follow official restrictions, curfews and checkpoints.':
      'Маршрути не заходять на окуповану чи спірну територію та в буферні зони й не перетинають закриті кордони України з росією, білоруссю та Придністров’ям, а також закритий кордон Туреччини з Вірменією. Інші пункти пропуску на кордоні з Молдовою працюють. Завжди дотримуйтесь офіційних обмежень, комендантської години та вимог блокпостів.',
    'Nearby cells': 'Комірки поруч', 'Alerts': 'Сповіщення', 'Chase log': 'Журнал погоні',
    'Set your position to get distances, ETAs and intercept solutions for tracked cells.': 'Вкажіть свою позицію, щоб отримати відстані, час підходу та рішення для перехоплення.',
    'No tracked cells within 400 km.': 'Немає комірок у радіусі 400 км.', 'Loading…': 'Завантаження…',
    'Alerts enabled': 'Сповіщення увімкнено', 'Lightning radius': 'Радіус блискавок',
    'Cell will pass over me': 'Комірка пройде наді мною', 'New high-potential storm': 'Нова гроза з високим потенціалом',
    'Storm warnings at my position': 'Штормові попередження в моїй точці', 'Air-raid alert in my oblast': 'Повітряна тривога в моїй області',
    'Sound': 'Звук', 'Enable desktop notifications': 'Увімкнути сповіщення', 'No alerts yet.': 'Сповіщень ще немає.',
    'Export GPX': 'Експорт GPX', 'Clear log': 'Очистити журнал', 'Share-safe text': 'Безпечний текст для поширення',
    '● Record GPS track': '● Записувати трек GPS', '■ Stop recording': '■ Зупинити запис',
    'Wall cloud': 'Стіна-хмара', 'Funnel cloud': 'Воронка', 'Tornado': 'Смерч', 'Large hail': 'Великий град',
    'Damaging wind': 'Шкідливий вітер', 'Heavy rain / flooding': 'Злива / підтоплення', 'Lightning damage': 'Пошкодження блискавкою',
    'Note / photo spot': 'Нотатка / місце для фото', 'Drive': 'Їхати', 'Distance': 'Відстань', 'Arrive': 'Прибуття',
    'Real roads (OSRM / OpenStreetMap)': 'Реальні дороги (OSRM / OpenStreetMap)', 'Approximate — no road data': 'Приблизно — без даних про дороги',
    'Waiting for GPS fix': 'Очікування GPS', 'GPS good': 'GPS в нормі', 'GPS degraded': 'GPS погіршений',
    'Keep last position': 'Залишити останню позицію', 'Accept new position': 'Прийняти нову позицію',
    'Mine-contamination map': 'Карта забруднення вибухонебезпечними предметами',
    // drawer
    'Point analysis': 'Аналіз точки', 'Forecast': 'Прогноз', 'Sounding': 'Зондування', 'Parameters': 'Параметри',
    'Time–height': 'Час–висота', 'Models': 'Моделі', 'Ensemble': 'Ансамбль', 'Close': 'Закрити', 'Close (Esc)': 'Закрити (Esc)',
    'What-if surface': 'Що як біля землі', 'Recompute': 'Перерахувати', 'Reset': 'Скинути', 'Overlay': 'Накладення',
    'Export': 'Експорт', '— compare model —': '— порівняти модель —', 'Precip': 'Опади', 'Gusts': 'Пориви',
    'Temp': 'Темп.', 'Dew pt': 'Точка роси', '500 hPa wind': 'Вітер 500 гПа', 'Isotachs': 'Ізотахи',
    'Normal wind': 'Нормальний вітер', 'Vertical cross-section': 'Вертикальний розріз',
    'Thermodynamics': 'Термодинаміка', 'Kinematics': 'Кінематика', 'Composites': 'Композитні індекси',
    'Storm motion': 'Рух грози', 'Supercell type': 'Тип суперкомірки', 'Advanced diagnostics': 'Розширена діагностика',
    'Temperature': 'Температура', 'Precipitation': 'Опади', 'Pressure': 'Тиск', 'Wind speed': 'Швидкість вітру',
    'Wind': 'Вітер', 'Height': 'Висота', 'Time': 'Час',
    // timeline / misc
    'NOW': 'ЗАРАЗ', 'Jump to now': 'Перейти до поточного часу', 'Play forecast (Space)': 'Відтворити прогноз (пробіл)',
    'Play radar loop (R)': 'Анімація радара (R)', 'RADAR': 'РАДАР',
    'About StormMap': 'Про StormMap', 'Data sources': 'Джерела даних', 'Shortcuts': 'Гарячі клавіші',
    'play / pause forecast': 'відтворити / пауза', 'forecast hour': 'година прогнозу', 'radar loop': 'анімація радара',
    'close analysis': 'закрити аналіз',
    'Automated guidance only — always cross-check official forecasts and warnings. Stay safe on the road.':
      'Лише автоматична оцінка — завжди звіряйтеся з офіційними прогнозами та попередженнями. Бережіть себе на дорозі.',
    'Units': 'Одиниці', 'Language': 'Мова', 'Interface': 'Інтерфейс', 'Moldova': 'Молдова', 'Radar colours': 'Кольори радара', 'Ventusky style': 'Стиль Ventusky', 'RainViewer original': 'Оригінал RainViewer', 'Hungary': 'Угорщина', 'Czech Republic': 'Чехія', 'Lithuania': 'Литва', 'Armenia': 'Вірменія',
    'Ukraine': 'Україна', 'Russia (European)': 'росія (європейська)', 'Türkiye': 'Туреччина', 'Romania': 'Румунія', 'Bulgaria': 'Болгарія',
    'Slovakia': 'Словаччина', 'Poland': 'Польща', 'Finland': 'Фінляндія', 'Germany': 'Німеччина', 'Belarus': 'білорусь',
    // quick layer bar
    'Rain': 'Опади', 'Clouds': 'Хмарність', 'Humidity': 'Вологість', 'Storms': 'Грози', 'Initiation': 'Зародження',
    'Synoptic': 'Синоптика', 'Shear': 'Зсув вітру', 'Surface': 'Біля землі', 'Total': 'Загальна', 'Sea level': 'Рівень моря',
    'Relative': 'Відносна', 'Dew point': 'Точка роси', 'Lifted index': 'Індекс підйому', 'Threat': 'Загроза',
    'Potential': 'Потенціал', 'Convergence': 'Конвергенція', 'Moisture flux': 'Потік вологи',
    '500 hPa vorticity': 'Вихор 500 гПа', '850 T-advection': 'Адвекція T 850', '850 frontogenesis': 'Фронтогенез 850',
    'of daylight left': 'світлового дня залишилось', 'Sunrise': 'Схід', 'Sunset': 'Захід', 'Golden hour': 'Золота година',
    'Civil dusk': 'Громадянські сутінки', 'Occupied': 'Окуповано', 'Contested': 'Спірні', 'Source': 'Джерело',
    'Map date': 'Дата карти', 'Grid precision': 'Точність сітки', 'Occupied area': 'Окупована площа',
  };

  // phrases inside longer, dynamic strings
  const PATTERNS = [
    [/^Moving (\w+) at (\d+) km\/h/, (m, d, v) => `Рух на ${d}, ${v} км/год`],
    [/\bapproaching\b/g, 'наближається'], [/\bmoving away\b/g, 'віддаляється'],
    [/^Route to /, 'Маршрут до '], [/^Intercept C/, 'Перехоплення C'],
    [/(\d+) km from you/, '$1 км від вас'],
    [/^All (\d+) countries$/, 'Усі $1 країн'], [/^Partial: /, 'Частково: '], [/^Until /, 'До '], [/ Kyiv · /, ' Київ · '],
    [/^updated /, 'оновлено '],
    [/(\d+) pts · /, '$1 точок · '],
  ];

  // rail buttons are narrow: short forms
  const RAIL = { 'Warnings': 'Попер.', 'Ranking': 'Рейтинг', 'Outlook': 'Прогноз', 'Tracker': 'Трекер' };

  const I = SM.i18n = { lang: 'en', dict: UK };
  let stored = null;
  try { stored = localStorage.getItem('sm-lang'); } catch (e) { /* ignore */ }
  I.lang = stored || ((navigator.language || '').toLowerCase().startsWith('uk') ? 'uk' : 'en');

  I.t = s => (I.lang === 'uk' && UK[s]) || s;

  function trText(s) {
    const t = s.trim();
    if (!t) return null;
    if (UK[t]) return s.replace(t, UK[t]);
    let out = s, hit = false;
    for (const [re, rep] of PATTERNS) {
      const n = out.replace(re, rep);
      if (n !== out) { out = n; hit = true; }
    }
    return hit ? out : null;
  }

  const ATTRS = ['title', 'placeholder', 'aria-label'];
  const SKIP = 'script,style,textarea,.leaflet-tile-pane,.mono,pre,kbd';

  function walk(root) {
    if (root.nodeType === 3) {
      const p = root.parentElement;
      if (p && !p.closest(SKIP)) {
        const n = p.closest('.rail-btn') && RAIL[root.nodeValue.trim()] ? RAIL[root.nodeValue.trim()] : trText(root.nodeValue);
        if (n != null && n !== root.nodeValue) root.nodeValue = n;
      }
      return;
    }
    if (root.nodeType !== 1 || root.matches(SKIP)) return;
    for (const a of ATTRS) {
      const v = root.getAttribute(a);
      if (v && UK[v.trim()]) root.setAttribute(a, UK[v.trim()]);
    }
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 1) {
        if (n.matches(SKIP)) continue;
        for (const a of ATTRS) { const v = n.getAttribute(a); if (v && UK[v.trim()]) n.setAttribute(a, UK[v.trim()]); }
      } else walk(n);
    }
  }

  I.apply = function () {
    if (I.lang !== 'uk') return;
    document.documentElement.lang = 'uk';
    walk(document.body);
    const mo = new MutationObserver(muts => {
      mo.disconnect();
      for (const m of muts) {
        if (m.type === 'characterData') walk(m.target);
        else m.addedNodes.forEach(walk);
      }
      mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  };

  I.set = function (lang) {
    try { localStorage.setItem('sm-lang', lang); } catch (e) { /* ignore */ }
    location.reload();
  };

  document.addEventListener('DOMContentLoaded', I.apply);
})();
