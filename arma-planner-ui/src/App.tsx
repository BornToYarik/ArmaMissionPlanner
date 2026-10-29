import React, { useState, useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import { toPng } from 'html-to-image';
import {
  Upload, Users, Map as MapIcon, FileText, Shield, Truck,
  Download, Copy, Eye, ChevronDown, ChevronRight, Plus, Trash2, Crosshair
} from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import type {
  MissionInfo, SquadUnit, MissionVehicle, TacticalPlanMarker
} from './types';

// Цвета SWT Markers (индексы для экспорта в массив Армы)
const SWT_COLORS = [
  { name: 'Черный', hex: '#000000', swtIdx: 0 },
  { name: 'Красный (OPFOR)', hex: '#ef4444', swtIdx: 1 },
  { name: 'Зеленый (IND)', hex: '#22c55e', swtIdx: 2 },
  { name: 'Синий (BLUFOR)', hex: '#3b82f6', swtIdx: 3 },
  { name: 'Желтый', hex: '#eab308', swtIdx: 4 },
  { name: 'Оранжевый', hex: '#f97316', swtIdx: 5 },
];

export default function App() {
  const [mission, setMission] = useState<MissionInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'booking' | 'map' | 'briefing'>('booking');
  const [selectedSide, setSelectedSide] = useState<string>('');

  // Бронирование: ключ = ID юнита, значение = тег отряда (например "COB", "UN")
  const [unitAssignments, setUnitAssignments] = useState<Record<number, string>>({});
  // Раскрытые отделения в таблице (для деления отделения между отрядами и просмотра юнитов)
  const [expandedGroups, setExpandedGroups] = useState<Record<number, boolean>>({});

  // Модалки инспектора юнита и техники
  const [inspectedUnit, setInspectedUnit] = useState<SquadUnit | null>(null);
  const [inspectedVehicle, setInspectedVehicle] = useState<MissionVehicle | null>(null);

  // Тактические маркеры КС-а (SWT)
  const [planMarkers, setPlanMarkers] = useState<TacticalPlanMarker[]>([]);
  const [newMarkerText, setNewMarkerText] = useState('Атака 1-1');
  const [newMarkerColorIdx, setNewMarkerColorIdx] = useState(1);
  const [swtArrayText, setSwtArrayText] = useState('');
  const [worldSize, setWorldSize] = useState<number>(15360); // 15360 — стандарт Черноруссии

  const bookingTableRef = useRef<HTMLDivElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const planLayerGroupRef = useRef<L.LayerGroup | null>(null);

  // Подгружаем текущую миссию при старте (если страница была обновлена по F5)
  useEffect(() => {
    fetch('/api/mission/current')
        .then(r => (r.ok ? r.json() : null))
        .then((data: MissionInfo | null) => {
          if (data) initMissionState(data);
        })
        .catch(() => {});
  }, []);

  const initMissionState = (data: MissionInfo) => {
    setMission(data);
    const sides = Array.from(new Set(data.groups.map(g => g.side)));
    if (sides.length > 0) setSelectedSide(sides[0]);
    setUnitAssignments({});
    setExpandedGroups({});
  };

  // Загрузка PBO файла
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/mission/upload', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('Ошибка чтения PBO');
      const data: MissionInfo = await res.json();
      initMissionState(data);
    } catch (err) {
      alert('Не удалось разобрать PBO файл: ' + err);
    } finally {
      setLoading(false);
    }
  };

  // Отделения выбранной стороны
  const sideGroups = useMemo(() => {
    if (!mission) return [];
    return mission.groups.filter(g => g.side === selectedSide);
  }, [mission, selectedSide]);

  // Назначить отряд всему отделению целиком
  const assignSquadWholeGroup = (groupId: number, clanTag: string) => {
    const group = sideGroups.find(g => g.id === groupId);
    if (!group) return;
    setUnitAssignments(prev => {
      const next = { ...prev };
      group.units.forEach(u => {
        next[u.id] = clanTag.trim();
      });
      return next;
    });
  };

  // Назначить отряд конкретному слоту внутри отделения (деление отделения)
  const assignSingleUnit = (unitId: number, clanTag: string) => {
    setUnitAssignments(prev => ({
      ...prev,
      [unitId]: clanTag.trim(),
    }));
  };

  // Подсчет сводной статистики по отрядам (учитывая поделенные отделения)
  const clanStats = useMemo(() => {
    const counts: Record<string, { total: number; details: Record<string, number> }> = {};
    let totalSideSlots = 0;
    let bookedSlots = 0;

    sideGroups.forEach(g => {
      g.units.forEach(u => {
        totalSideSlots++;
        const clan = unitAssignments[u.id]?.trim();
        if (clan) {
          bookedSlots++;
          if (!counts[clan]) counts[clan] = { total: 0, details: {} };
          counts[clan].total++;
          counts[clan].details[g.callSign] = (counts[clan].details[g.callSign] || 0) + 1;
        }
      });
    });

    return {
      totalSideSlots,
      bookedSlots,
      freeSlots: totalSideSlots - bookedSlots,
      clans: Object.entries(counts).sort((a, b) => b[1].total - a[1].total),
    };
  }, [sideGroups, unitAssignments]);

  // Экспорт таблицы расстановки в PNG
  const exportTableToPng = async () => {
    if (!bookingTableRef.current) return;
    try {
      const dataUrl = await toPng(bookingTableRef.current, {
        backgroundColor: '#0f172a',
        pixelRatio: 2,
      });
      const link = document.createElement('a');
      link.download = `${mission?.name || 'plan'}_${selectedSide}_booking.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      alert('Ошибка создания PNG: ' + err);
    }
  };

  // Копирование расстановки в текстовом виде (для Discord / Форума)
  const copyBookingAsText = () => {
    const lines: string[] = [`**${mission?.name} (${selectedSide})**`, ''];
    sideGroups.forEach(g => {
      const groupClans: Record<string, number> = {};
      g.units.forEach(u => {
        const c = unitAssignments[u.id] || 'Свободно';
        groupClans[c] = (groupClans[c] || 0) + 1;
      });
      const summary = Object.entries(groupClans)
          .map(([c, cnt]) => (Object.keys(groupClans).length === 1 ? `[${c}]` : `[${c}: ${cnt}]`))
          .join(' + ');
      lines.push(`**${g.callSign}** (${g.squadDescription || 'Пехота'}, ${g.units.length} сл.) — ${summary}`);
    });
    navigator.clipboard.writeText(lines.join('\n'));
    alert('Таблица скопирована в буфер обмена для Discord!');
  };

  // Генерация массива SWT Markers для вставки в Арме
  const exportSwtArray = () => {
    // Формат SWT: [["Текст",[X,Y,0],TypeIdx,ColorIdx,Dir,[SizeA,SizeB]], ...]
    const swtItems = planMarkers.map(m => {
      const safeText = m.text.replace(/"/g, '""');
      return `["${safeText}",[${Math.round(m.x)},${Math.round(m.y)},0],${m.swtTypeIndex},${m.swtColorIndex},0,[1,1]]`;
    });
    const result = `[${swtItems.join(',')}]`;
    setSwtArrayText(result);
    navigator.clipboard.writeText(result);
  };

  // Импорт массива SWT Markers из строки
  const importSwtArray = () => {
    if (!swtArrayText.trim()) return;
    try {
      const regex = /\[\s*"([^"]*)"\s*,\s*\[\s*([\d.-]+)\s*,\s*([\d.-]+)(?:\s*,\s*[\d.-]+)?\s*\]\s*,\s*(\d+)\s*,\s*(\d+)/g;
      const imported: TacticalPlanMarker[] = [];
      let match: RegExpExecArray | null;
      while ((match = regex.exec(swtArrayText)) !== null) {
        const colorIdx = parseInt(match[5], 10);
        const colorObj = SWT_COLORS.find(c => c.swtIdx === colorIdx) || SWT_COLORS[1];
        imported.push({
          id: crypto.randomUUID(),
          text: match[1],
          x: parseFloat(match[2]),
          y: parseFloat(match[3]),
          swtTypeIndex: parseInt(match[4], 10),
          swtColorIndex: colorIdx,
          color: colorObj.hex,
        });
      }
      if (imported.length === 0) {
        alert('Не удалось распознать маркеры в массиве.');
        return;
      }
      setPlanMarkers(prev => [...prev, ...imported]);
    } catch (e) {
      alert('Ошибка разбора массива: ' + e);
    }
  };

  // Автоматически подгружаем map.json острова при загрузке миссии (чтобы выставить правильный worldSize)
  const [mapConfig, setMapConfig] = useState<{
    worldSize: number;
    imageSize: number;
    multiplier: number;
    maxZoom: number;
  } | null>(null);

  useEffect(() => {
    if (!mission?.worldName) return;
    fetch(`/api/maps/${mission.worldName.toLowerCase()}/map.json`)
        .then(r => (r.ok ? r.json() : null))
        .then(cfg => {
          if (cfg && cfg.worldSize) {
            setMapConfig(cfg);
            setWorldSize(cfg.worldSize);
          } else {
            setMapConfig(null);
          }
        })
        .catch(() => setMapConfig(null));
  }, [mission?.worldName]);

  // Инициализация и отрисовка тактической карты Leaflet
  useEffect(() => {
    if (activeTab !== 'map' || !mission || !mapContainerRef.current) return;

    if (leafletMapRef.current) {
      leafletMapRef.current.remove();
      leafletMapRef.current = null;
    }

    const maxZoom = mapConfig?.maxZoom ?? 7;
    const multiplier = mapConfig?.multiplier ?? 1;
    // На зуме 0 один пиксель тайла равен scale игровых метров (для Altis = 128)
    const scale = Math.pow(2, maxZoom) / multiplier;

    // Кастомная CRS: оставляет твои координаты [y, x] в метрах Армы (0..worldSize),
    // но масштабирует тайлы GDAL2Tiles ровно под размер острова!
    const armaCrs = L.extend({}, L.CRS.Simple, {
      transformation: new L.Transformation(1 / scale, 0, -1 / scale, worldSize / scale),
    });

    const map = L.map(mapContainerRef.current, {
      crs: armaCrs,
      minZoom: 0,
      maxZoom: maxZoom,
    });
    leafletMapRef.current = map;

    const bounds: L.LatLngBoundsExpression = [
      [0, 0],
      [worldSize, worldSize],
    ];

    // Подложка координатной сетки Армы (по 1 км)
    const gridGroup = L.layerGroup().addTo(map);
    L.rectangle(bounds).addTo(gridGroup);

    // Слой топографической карты из папки maps/<worldName>/{z}/{x}/{y}.png
    const worldKey = mission.worldName.toLowerCase();
    L.tileLayer(`/api/maps/${worldKey}/{z}/{x}/{y}.png`, {
      minZoom: 0,
      maxZoom: maxZoom,
      tileSize: 256,
      noWrap: true,
      bounds: bounds,
    }).addTo(map);

    // Сетка 1х1 км поверх карты (полупрозрачная)
    for (let i = 0; i <= worldSize; i += 1000) {
      L.polyline([[0, i], [worldSize, i]], { color: 'rgba(30, 41, 59, 0.35)', weight: 1 }).addTo(gridGroup);
      L.polyline([[i, 0], [i, worldSize]], { color: 'rgba(30, 41, 59, 0.35)', weight: 1 }).addTo(gridGroup);
    }

    map.fitBounds(bounds);

    // 1. Отрисовка маркеров из самой миссии (зоны, задачи)
    mission.markers.forEach(m => {
      if (m.position.length < 3) return;
      const x = m.position[0];
      const y = m.position[2];

      if (m.markerType === 'RECTANGLE' || m.markerType === 'ELLIPSE') {
        L.rectangle(
            [[y - m.heightB, x - m.widthA], [y + m.heightB, x + m.widthA]],
            { color: '#ef4444', weight: 2, fillOpacity: 0.2 }
        )
            .bindTooltip(m.text || m.name)
            .addTo(map);
      } else if (m.text) {
        const icon = L.divIcon({
          className: 'custom-mission-marker',
          html: `<div style="color:#cbd5e1;font-size:11px;font-weight:bold;text-shadow:1px 1px 2px #000;white-space:nowrap;">• ${m.text}</div>`,
        });
        L.marker([y, x], { icon }).addTo(map);
      }
    });

    // 2. Отрисовка стартовых позиций отделений (по позиции КО)
    mission.groups.forEach(g => {
      const leader = g.units[0];
      if (!leader || leader.position.length < 3) return;
      const x = leader.position[0];
      const y = leader.position[2];
      const sideColor =
          g.side === 'West' ? '#3b82f6' : g.side === 'East' ? '#ef4444' : '#22c55e';

      const icon = L.divIcon({
        className: 'squad-marker',
        html: `<div style="background:${sideColor};color:#fff;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:bold;border:1px solid #fff;white-space:nowrap;box-shadow:0 2px 4px rgba(0,0,0,0.6);">
          ${g.callSign} (${g.units.length})
        </div>`,
      });
      L.marker([y, x], { icon })
          .bindPopup(`<b>[${g.side}] ${g.callSign}</b><br/>${g.squadDescription || 'Пехота'}<br/>Слотов: ${g.units.length}`)
          .addTo(map);
    });

    // 3. Отрисовка техники и ящиков (с открытием инвентаря по клику)
    mission.vehicles.forEach(v => {
      if (v.position.length < 3) return;
      const x = v.position[0];
      const y = v.position[2];

      const marker = L.circleMarker([y, x], {
        radius: 6,
        fillColor: v.cargo.hasAnyCargo ? '#f59e0b' : '#94a3b8',
        color: '#0f172a',
        weight: 2,
        fillOpacity: 0.95,
      }).addTo(map);

      marker.bindTooltip(`${v.vehicleClass}${v.cargo.hasAnyCargo ? ' (Есть БК/Груз)' : ''}`);
      marker.on('click', () => {
        setInspectedVehicle(v);
      });
    });

    // 4. Слой пользовательских меток плана КС-а
    const planLayer = L.layerGroup().addTo(map);
    planLayerGroupRef.current = planLayer;

    // Клик по карте ставит новую тактическую метку
    map.on('click', (e: L.LeafletMouseEvent) => {
      const colorObj = SWT_COLORS[newMarkerColorIdx] || SWT_COLORS[1];
      setPlanMarkers(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          text: newMarkerText || 'Метка',
          x: Math.round(e.latlng.lng),
          y: Math.round(e.latlng.lat),
          color: colorObj.hex,
          swtColorIndex: colorObj.swtIdx,
          swtTypeIndex: 0,
        },
      ]);
    });

    return () => {
      map.remove();
      leafletMapRef.current = null;
    };
  }, [activeTab, mission, worldSize, mapConfig]);

  // Обновление слоя меток КС-а при добавлении/удалении
  useEffect(() => {
    const layer = planLayerGroupRef.current;
    if (!layer) return;
    layer.clearLayers();

    planMarkers.forEach(m => {
      const icon = L.divIcon({
        className: 'plan-marker',
        html: `<div style="display:flex;align-items:center;gap:4px;white-space:nowrap;">
          <span style="width:10px;height:10px;border-radius:50%;background:${m.color};border:2px solid #fff;display:inline-block;"></span>
          <span style="color:${m.color};background:rgba(15,23,42,0.85);padding:1px 5px;border-radius:3px;font-weight:bold;font-size:12px;border:1px solid ${m.color};">${m.text}</span>
        </div>`,
      });
      L.marker([m.y, m.x], { icon }).addTo(layer);
    });
  }, [planMarkers, activeTab]);

  // Получить отображаемую сводку отрядов для заголовка отделения
  const getGroupAssignedSummary = (groupId: number) => {
    const group = sideGroups.find(g => g.id === groupId);
    if (!group) return '';
    const tags = new Set(group.units.map(u => unitAssignments[u.id] || '').filter(Boolean));
    if (tags.size === 0) return '';
    if (tags.size === 1) return Array.from(tags)[0];
    return Array.from(tags).join(' / ');
  };

  return (
      <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
        {/* Верхняя панель */}
        <header className="border-b border-slate-800 bg-slate-900/80 px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Crosshair className="w-7 h-7 text-emerald-400" />
            <div>
              <h1 className="text-lg font-bold tracking-wide">
                {mission ? mission.name : 'WOG Arma 3 Mission Planner'}
              </h1>
              <p className="text-xs text-slate-400">
                {mission
                    ? `Остров: ${mission.worldName} | Автор: ${mission.author} | ${mission.overview}`
                    : 'Загрузите .pbo файл миссии для начала планирования'}
              </p>
            </div>
          </div>

          <label className="cursor-pointer inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-4 py-2 rounded-lg text-sm transition">
            <Upload className="w-4 h-4" />
            <span>{loading ? 'Разбор PBO...' : 'Загрузить .PBO'}</span>
            <input type="file" accept=".pbo" onChange={handleFileUpload} className="hidden" />
          </label>
        </header>

        {/* Полоска параметров WMT */}
        {mission && (
            <div className="bg-slate-900/50 border-b border-slate-800 px-6 py-2.5 flex flex-wrap items-center gap-6 text-xs text-slate-300">
              <div><span className="text-slate-500">Прорисовка:</span> <b>{mission.wmtSettings.viewDistance} м</b> (Земля: {mission.wmtSettings.terrainViewDistance} м)</div>
              <div><span className="text-slate-500">Тепловизор:</span> <b className="text-amber-400">{mission.wmtSettings.thermalMode}</b></div>
              <div><span className="text-slate-500">Время миссии:</span> <b>{mission.wmtSettings.missionTimeMinutes} мин</b> (Фризтайм: {mission.wmtSettings.freezeTimeMinutes} мин)</div>
              <div><span className="text-slate-500">Стартовая зона:</span> <b>{mission.wmtSettings.startZoneSize} м</b></div>
              <div><span className="text-slate-500">Потери:</span> <b>{(mission.wmtSettings.heavyLossesCoeff * 100).toFixed(1)}%</b></div>
              {mission.wmtSettings.winnerByTimeText && (
                  <div><span className="text-slate-500">По истечении времени:</span> <b className="text-sky-400">{mission.wmtSettings.winnerByTimeText}</b></div>
              )}
            </div>
        )}

        {/* Навигация по вкладкам */}
        {mission && (
            <div className="border-b border-slate-800 px-6 flex items-center justify-between bg-slate-900/30">
              <div className="flex gap-2">
                <button
                    onClick={() => setActiveTab('booking')}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition ${
                        activeTab === 'booking'
                            ? 'border-emerald-500 text-emerald-400'
                            : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                >
                  <Users className="w-4 h-4" />
                  Расстановка и Снаряжение ({sideGroups.length} отд.)
                </button>
                <button
                    onClick={() => setActiveTab('map')}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition ${
                        activeTab === 'map'
                            ? 'border-emerald-500 text-emerald-400'
                            : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                >
                  <MapIcon className="w-4 h-4" />
                  Тактическая карта и Техника ({mission.vehicles.length})
                </button>
                <button
                    onClick={() => setActiveTab('briefing')}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition ${
                        activeTab === 'briefing'
                            ? 'border-emerald-500 text-emerald-400'
                            : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                >
                  <FileText className="w-4 h-4" />
                  Брифинг и Формы сторон ({mission.briefingImages.length})
                </button>
              </div>

              {/* Переключатель стороны */}
              <div className="flex items-center gap-2 py-2">
                <span className="text-xs text-slate-400">Сторона:</span>
                {Array.from(new Set(mission.groups.map(g => g.side))).map(side => (
                    <button
                        key={side}
                        onClick={() => setSelectedSide(side)}
                        className={`px-3 py-1 rounded text-xs font-semibold transition ${
                            selectedSide === side
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                        }`}
                    >
                      {side}
                    </button>
                ))}
              </div>
            </div>
        )}

        {/* Основной контент */}
        <main className="flex-1 p-6">
          {!mission ? (
              <div className="max-w-xl mx-auto mt-20 text-center border-2 border-dashed border-slate-800 rounded-2xl p-12 bg-slate-900/30">
                <Upload className="w-12 h-12 text-slate-500 mx-auto mb-4" />
                <h2 className="text-xl font-semibold mb-2">Закиньте PBO файл миссии</h2>
                <p className="text-sm text-slate-400 mb-6">
                  Парсер автоматически достанет отделения, вооружение из SQF, содержимое техники, настройки WMT и картинки форм сторон.
                </p>
                <label className="cursor-pointer inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-6 py-2.5 rounded-lg text-sm transition">
                  <span>Выбрать .pbo на диске</span>
                  <input type="file" accept=".pbo" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>
          ) : (
              <>
                {/* ВКЛАДКА 1: РАССТАНОВКА И СНАРЯЖЕНИЕ */}
                {activeTab === 'booking' && (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <p className="text-xs text-slate-400">
                          Впишите тег отряда напротив отделения, чтобы отдать его целиком, или раскройте отделение, чтобы поделить слоты между несколькими отрядами.
                        </p>
                        <div className="flex gap-2">
                          <button
                              onClick={copyBookingAsText}
                              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded text-xs font-medium transition"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            Скопировать для Discord
                          </button>
                          <button
                              onClick={exportTableToPng}
                              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded text-xs font-medium transition"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Скачать таблицу в PNG
                          </button>
                        </div>
                      </div>

                      {/* Область, которая рендерится в PNG */}
                      <div ref={bookingTableRef} className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-4 rounded-xl bg-slate-950">
                        {/* Левая колонка: Список отделений */}
                        <div className="lg:col-span-2 space-y-2.5">
                          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3">
                            Отделения стороны {selectedSide} ({mission.name})
                          </h2>
                          {sideGroups.map(group => {
                            const isExpanded = !!expandedGroups[group.id];
                            const groupSummary = getGroupAssignedSummary(group.id);

                            return (
                                <div key={group.id} className="border border-slate-800 rounded-lg bg-slate-900/60 overflow-hidden">
                                  <div className="px-4 py-2.5 flex items-center justify-between gap-4">
                                    <div
                                        onClick={() => setExpandedGroups(p => ({ ...p, [group.id]: !p[group.id] }))}
                                        className="flex items-center gap-3 cursor-pointer flex-1"
                                    >
                                      {isExpanded ? (
                                          <ChevronDown className="w-4 h-4 text-slate-400" />
                                      ) : (
                                          <ChevronRight className="w-4 h-4 text-slate-400" />
                                      )}
                                      <div>
                                        <div className="flex items-center gap-2">
                                          <span className="font-bold text-emerald-400">{group.callSign}</span>
                                          <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
                                    {group.units.length} сл.
                                  </span>
                                          {group.squadDescription && (
                                              <span className="text-sm font-medium text-slate-200">
                                      {group.squadDescription}
                                    </span>
                                          )}
                                        </div>
                                      </div>
                                    </div>

                                    {/* Быстрое назначение отряда на всё отделение */}
                                    <div className="flex items-center gap-2">
                                      {groupSummary.includes('/') && (
                                          <span className="text-xs text-amber-400 font-medium">
                                  Поделено: {groupSummary}
                                </span>
                                      )}
                                      <input
                                          type="text"
                                          placeholder="Отряд (напр. COB)"
                                          value={groupSummary.includes('/') ? '' : groupSummary}
                                          onChange={e => assignSquadWholeGroup(group.id, e.target.value)}
                                          className="bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded px-2.5 py-1 text-xs w-36 outline-none text-center font-semibold"
                                      />
                                    </div>
                                  </div>

                                  {/* Раскрытый список юнитов отделения */}
                                  {isExpanded && (
                                      <div className="border-t border-slate-800 bg-slate-950/50 divide-y divide-slate-800/60">
                                        {group.units.map((u, idx) => (
                                            <div key={u.id} className="px-4 py-2 flex items-center justify-between gap-3 text-xs">
                                              <div className="flex items-center gap-3 min-w-0">
                                                <span className="text-slate-500 w-4">{idx + 1}.</span>
                                                <span className="font-medium text-slate-200 truncate">
                                      {u.roleDescription || u.vehicleClass}
                                    </span>
                                                {u.primaryWeapon && (
                                                    <span className="bg-slate-800 text-sky-300 px-2 py-0.5 rounded font-mono text-[11px]">
                                        {u.primaryWeapon}
                                      </span>
                                                )}
                                                {u.secondaryWeapon && (
                                                    <span className="bg-amber-950/80 text-amber-300 px-2 py-0.5 rounded font-mono text-[11px]">
                                        {u.secondaryWeapon}
                                      </span>
                                                )}
                                              </div>

                                              <div className="flex items-center gap-2 shrink-0">
                                                <button
                                                    onClick={() => setInspectedUnit(u)}
                                                    className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded transition"
                                                    title="Посмотреть полное снаряжение юнита"
                                                >
                                                  <Eye className="w-3.5 h-3.5" />
                                                  <span>Снаряга ({Object.values(u.loadout.itemsAndMagazines).reduce((a, b) => a + b, 0)})</span>
                                                </button>
                                                <input
                                                    type="text"
                                                    placeholder="Отряд слота"
                                                    value={unitAssignments[u.id] || ''}
                                                    onChange={e => assignSingleUnit(u.id, e.target.value)}
                                                    className="bg-slate-900 border border-slate-800 focus:border-emerald-500 rounded px-2 py-1 w-28 text-center font-semibold outline-none"
                                                />
                                              </div>
                                            </div>
                                        ))}
                                      </div>
                                  )}
                                </div>
                            );
                          })}
                        </div>

                        {/* Правая колонка: Сводная статистика по отрядам */}
                        <div className="border border-slate-800 rounded-lg bg-slate-900/60 p-4 h-fit space-y-4">
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">
                            Статистика бронирования
                          </h3>

                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                              <div className="text-lg font-bold text-slate-100">{clanStats.totalSideSlots}</div>
                              <div className="text-[11px] text-slate-400">Всего слотов</div>
                            </div>
                            <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                              <div className="text-lg font-bold text-emerald-400">{clanStats.bookedSlots}</div>
                              <div className="text-[11px] text-slate-400">Занято</div>
                            </div>
                            <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                              <div className="text-lg font-bold text-amber-400">{clanStats.freeSlots}</div>
                              <div className="text-[11px] text-slate-400">Свободно</div>
                            </div>
                          </div>

                          <div className="space-y-2">
                            {clanStats.clans.length === 0 ? (
                                <p className="text-xs text-slate-500 text-center py-6">
                                  Пока не назначен ни один отряд
                                </p>
                            ) : (
                                clanStats.clans.map(([clanName, info]) => (
                                    <div key={clanName} className="bg-slate-950 border border-slate-800 rounded p-2.5 text-xs">
                                      <div className="flex items-center justify-between font-bold text-sm mb-1">
                                        <span className="text-emerald-400">[{clanName}]</span>
                                        <span>{info.total} сл.</span>
                                      </div>
                                      <div className="text-slate-400 text-[11px]">
                                        {Object.entries(info.details)
                                            .map(([callSign, cnt]) => `${callSign} (${cnt})`)
                                            .join(', ')}
                                      </div>
                                    </div>
                                ))
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                )}

                {/* ВКЛАДКА 2: ТАКТИЧЕСКАЯ КАРТА, ТЕХНИКА И SWT MARKERS */}
                {activeTab === 'map' && (
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                      {/* Карта */}
                      <div className="lg:col-span-3 space-y-2">
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span>Клик по карте — поставить тактическую метку. Клик по кружку техники — открыть инвентарь кузова/ящика.</span>
                          <div className="flex items-center gap-2">
                            <span>Размер карты (м):</span>
                            <input
                                type="number"
                                value={worldSize}
                                onChange={e => setWorldSize(Number(e.target.value) || 15360)}
                                className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 w-24 text-slate-200"
                            />
                          </div>
                        </div>
                        <div
                            ref={mapContainerRef}
                            className="w-full h-[680px] rounded-xl border border-slate-800 overflow-hidden"
                        />
                      </div>

                      {/* Боковая панель: SWT Маркеры и Список Техники */}
                      <div className="space-y-4">
                        {/* Панель SWT Markers */}
                        <div className="border border-slate-800 rounded-xl bg-slate-900/60 p-4 space-y-3">
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
                            Метки плана (SWT Markers)
                          </h3>

                          <div className="space-y-2 text-xs">
                            <label className="block text-slate-400">Текст новой метки (при клике по карте):</label>
                            <input
                                type="text"
                                value={newMarkerText}
                                onChange={e => setNewMarkerText(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 outline-none"
                            />

                            <label className="block text-slate-400">Цвет метки:</label>
                            <select
                                value={newMarkerColorIdx}
                                onChange={e => setNewMarkerColorIdx(Number(e.target.value))}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 outline-none"
                            >
                              {SWT_COLORS.map((c, idx) => (
                                  <option key={c.name} value={idx}>{c.name}</option>
                              ))}
                            </select>
                          </div>

                          {planMarkers.length > 0 && (
                              <div className="max-h-36 overflow-y-auto divide-y divide-slate-800 border border-slate-800 rounded bg-slate-950 p-2 text-xs">
                                {planMarkers.map(m => (
                                    <div key={m.id} className="py-1 flex items-center justify-between">
                            <span style={{ color: m.color }} className="font-semibold truncate">
                              {m.text} [{m.x}, {m.y}]
                            </span>
                                      <button
                                          onClick={() => setPlanMarkers(prev => prev.filter(x => x.id !== m.id))}
                                          className="text-slate-500 hover:text-rose-400"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                ))}
                              </div>
                          )}

                          <div className="space-y-2 pt-2 border-t border-slate-800 text-xs">
                            <div className="flex gap-2">
                              <button
                                  onClick={exportSwtArray}
                                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-1.5 rounded transition"
                              >
                                Экспорт в SWT
                              </button>
                              <button
                                  onClick={importSwtArray}
                                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium py-1.5 rounded transition"
                              >
                                Импорт из SWT
                              </button>
                            </div>
                            <textarea
                                rows={3}
                                placeholder='Массив SWT: [["Атака",[10200,9800,0],0,1,0,[1,1]]]'
                                value={swtArrayText}
                                onChange={e => setSwtArrayText(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded p-2 font-mono text-[11px] outline-none"
                            />
                          </div>
                        </div>

                        {/* Список техники и ящиков со снаряжением */}
                        <div className="border border-slate-800 rounded-xl bg-slate-900/60 p-4 space-y-3">
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                            <Truck className="w-4 h-4 text-amber-400" />
                            Техника и Ящики ({mission.vehicles.length})
                          </h3>
                          <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1 text-xs">
                            {mission.vehicles.map(v => (
                                <div
                                    key={v.id}
                                    onClick={() => setInspectedVehicle(v)}
                                    className="p-2 rounded bg-slate-950 hover:bg-slate-800/80 border border-slate-800 cursor-pointer flex items-center justify-between gap-2 transition"
                                >
                                  <div className="truncate">
                                    <div className="font-mono text-slate-200 truncate">{v.vehicleClass}</div>
                                    <div className="text-[10px] text-slate-500">
                                      X={v.position[0]?.toFixed(0)}, Y={v.position[2]?.toFixed(0)}
                                    </div>
                                  </div>
                                  {v.cargo.hasAnyCargo && (
                                      <span className="shrink-0 bg-amber-950 text-amber-300 border border-amber-800 px-1.5 py-0.5 rounded text-[10px]">
                              Груз
                            </span>
                                  )}
                                </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                )}

                {/* ВКЛАДКА 3: БРИФИНГ И ФОРМЫ СТОРОН */}
                {activeTab === 'briefing' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      <div className="lg:col-span-2 space-y-4">
                        {mission.briefing.map((b, idx) => (
                            <div key={idx} className="border border-slate-800 rounded-xl bg-slate-900/60 p-5">
                              <h3 className="text-base font-bold text-emerald-400 mb-3">{b.title}</h3>
                              <div
                                  className="text-sm text-slate-300 leading-relaxed space-y-2 whitespace-pre-wrap"
                                  dangerouslySetInnerHTML={{ __html: b.htmlText }}
                              />
                            </div>
                        ))}
                      </div>

                      {/* Картинки форм сторон из PBO */}
                      <div className="space-y-4">
                        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                          <Shield className="w-4 h-4 text-emerald-400" />
                          Формы сторон из PBO ({mission.briefingImages.length})
                        </h3>
                        {mission.briefingImages.map(img => (
                            <div key={img} className="border border-slate-800 rounded-xl bg-slate-900/60 p-3">
                              <div className="text-xs font-mono text-slate-400 mb-2">{img}</div>
                              <img
                                  src={`/api/mission/image?path=${encodeURIComponent(img)}`}
                                  alt={img}
                                  className="w-full rounded-lg border border-slate-800"
                              />
                            </div>
                        ))}
                      </div>
                    </div>
                )}
              </>
          )}
        </main>

        {/* МОДАЛКА: СНАРЯЖЕНИЕ ЮНИТА */}
        {inspectedUnit && (
            <div
                onClick={() => setInspectedUnit(null)}
                className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50"
            >
              <div
                  onClick={e => e.stopPropagation()}
                  className="bg-slate-900 border border-slate-700 rounded-xl max-w-lg w-full p-5 space-y-4 text-xs"
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div>
                    <h3 className="text-base font-bold text-emerald-400">
                      {inspectedUnit.roleDescription || inspectedUnit.vehicleClass}
                    </h3>
                    <p className="text-slate-400 font-mono">{inspectedUnit.vehicleClass}</p>
                  </div>
                  <button onClick={() => setInspectedUnit(null)} className="text-slate-400 hover:text-white text-sm">
                    ✕
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 bg-slate-950 p-3 rounded border border-slate-800">
                  <div><span className="text-slate-500">Основное:</span> <b className="font-mono text-sky-300">{inspectedUnit.primaryWeapon || '—'}</b></div>
                  <div><span className="text-slate-500">Труба/ПТ:</span> <b className="font-mono text-amber-300">{inspectedUnit.secondaryWeapon || '—'}</b></div>
                  <div><span className="text-slate-500">Пистолет:</span> <b className="font-mono">{inspectedUnit.handgun || '—'}</b></div>
                  <div><span className="text-slate-500">Форма:</span> <b className="font-mono">{inspectedUnit.loadout.uniform || '—'}</b></div>
                  <div><span className="text-slate-500">Разгрузка:</span> <b className="font-mono">{inspectedUnit.loadout.vest || '—'}</b></div>
                  <div><span className="text-slate-500">Рюкзак:</span> <b className="font-mono">{inspectedUnit.loadout.backpack || '—'}</b></div>
                  <div><span className="text-slate-500">Шлем:</span> <b className="font-mono">{inspectedUnit.loadout.headgear || '—'}</b></div>
                </div>

                {inspectedUnit.loadout.weaponAttachments.length > 0 && (
                    <div>
                      <div className="font-semibold text-slate-400 mb-1">Обвесы и прицелы:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {inspectedUnit.loadout.weaponAttachments.map(a => (
                            <span key={a} className="bg-slate-800 px-2 py-0.5 rounded font-mono">{a}</span>
                        ))}
                      </div>
                    </div>
                )}

                <div>
                  <div className="font-semibold text-slate-400 mb-1">Боекомплект и снаряжение в инвентаре:</div>
                  <div className="max-h-56 overflow-y-auto divide-y divide-slate-800 bg-slate-950 rounded border border-slate-800 px-3 py-1">
                    {Object.entries(inspectedUnit.loadout.itemsAndMagazines).map(([item, count]) => (
                        <div key={item} className="py-1 flex justify-between font-mono">
                          <span>{item}</span>
                          <span className="text-emerald-400 font-bold">x{count}</span>
                        </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
        )}

        {/* МОДАЛКА: ИНВЕНТАРЬ ТЕХНИКИ / ЯЩИКА */}
        {inspectedVehicle && (
            <div
                onClick={() => setInspectedVehicle(null)}
                className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50"
            >
              <div
                  onClick={e => e.stopPropagation()}
                  className="bg-slate-900 border border-slate-700 rounded-xl max-w-lg w-full p-5 space-y-4 text-xs"
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div>
                    <h3 className="text-base font-bold text-amber-400">{inspectedVehicle.vehicleClass}</h3>
                    <p className="text-slate-400">
                      Координаты: X={inspectedVehicle.position[0]?.toFixed(0)}, Y={inspectedVehicle.position[2]?.toFixed(0)}
                    </p>
                  </div>
                  <button onClick={() => setInspectedVehicle(null)} className="text-slate-400 hover:text-white text-sm">
                    ✕
                  </button>
                </div>

                {!inspectedVehicle.cargo.hasAnyCargo ? (
                    <p className="text-slate-400 py-4 text-center">Кузов пуст (дополнительный лут через SQF не выдан)</p>
                ) : (
                    <div className="max-h-80 overflow-y-auto space-y-3">
                      {Object.entries({
                        'Оружие и ПТ-средства': inspectedVehicle.cargo.weapons,
                        'Боекомплект (Магазины / Снаряды / Гранаты)': inspectedVehicle.cargo.magazines,
                        'Медицина и Предметы': inspectedVehicle.cargo.items,
                        'Рюкзаки': inspectedVehicle.cargo.backpacks,
                      }).map(([category, dict]) =>
                          Object.keys(dict).length > 0 ? (
                              <div key={category}>
                                <div className="font-semibold text-slate-400 mb-1">{category}:</div>
                                <div className="divide-y divide-slate-800 bg-slate-950 rounded border border-slate-800 px-3 py-1 font-mono">
                                  {Object.entries(dict).map(([k, v]) => (
                                      <div key={k} className="py-1 flex justify-between">
                                        <span>{k}</span>
                                        <span className="text-amber-400 font-bold">x{v}</span>
                                      </div>
                                  ))}
                                </div>
                              </div>
                          ) : null
                      )}
                    </div>
                )}
              </div>
            </div>
        )}
      </div>
  );
}