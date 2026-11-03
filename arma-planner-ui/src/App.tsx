import React, { useState, useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import { toPng } from 'html-to-image';
import 'leaflet/dist/leaflet.css';
import type {
  MissionInfo, SquadUnit, MissionVehicle
} from './types';
import {
  Upload, Users, Map as MapIcon, FileText, Shield, Truck,
  Download, Copy, Eye, ChevronDown, ChevronRight, Trash2, Crosshair,
  CheckCircle2, AlertTriangle, XCircle
} from 'lucide-react';

// Компонент умной загрузки PNG-иконки класса из твоей выгрузки (с тихим скрытием, если иконки нет)
const ClassIcon: React.FC<{ classNameStr?: string; size?: string }> = ({
                                                                         classNameStr,
                                                                         size = 'h-6 w-auto max-w-[44px]',
                                                                       }) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [classNameStr]);

  if (!classNameStr || failed) return null;

  return (
      <img
          src={`/api/assets/icon/${encodeURIComponent(classNameStr)}`}
          alt={classNameStr}
          onError={() => setFailed(true)}
          className={`${size} object-contain shrink-0 drop-shadow`}
          loading="lazy"
      />
  );
};

// Полная палитра цветов SWT Markers
export interface SwtColorDef {
  swtIdx: number;
  armaClass: string;
  name: string;
  hex: string;
}

const SWT_COLORS: SwtColorDef[] = [
  { swtIdx: 0, armaClass: 'Default', name: 'Черный (Default)', hex: '#0f172a' },
  { swtIdx: 1, armaClass: 'ColorBlack', name: 'Черный', hex: '#000000' },
  { swtIdx: 2, armaClass: 'ColorGrey', name: 'Серый', hex: '#64748b' },
  { swtIdx: 3, armaClass: 'ColorRed', name: 'Красный', hex: '#dc2626' },
  { swtIdx: 4, armaClass: 'ColorBrown', name: 'Коричневый', hex: '#78350f' },
  { swtIdx: 5, armaClass: 'ColorOrange', name: 'Оранжевый', hex: '#ea580c' },
  { swtIdx: 6, armaClass: 'ColorYellow', name: 'Желтый', hex: '#eab308' },
  { swtIdx: 7, armaClass: 'ColorKhaki', name: 'Хаки', hex: '#65a30d' },
  { swtIdx: 8, armaClass: 'ColorGreen', name: 'Зеленый', hex: '#16a34a' },
  { swtIdx: 9, armaClass: 'ColorBlue', name: 'Синий', hex: '#2563eb' },
  { swtIdx: 10, armaClass: 'ColorPink', name: 'Розовый', hex: '#db2777' },
  { swtIdx: 11, armaClass: 'ColorWhite', name: 'Белый', hex: '#f8fafc' },
  { swtIdx: 12, armaClass: 'ColorWEST', name: 'BLUFOR (Синий)', hex: '#004d99' },
  { swtIdx: 13, armaClass: 'ColorEAST', name: 'OPFOR (Красный)', hex: '#800000' },
  { swtIdx: 14, armaClass: 'ColorGUER', name: 'IND (Зеленый)', hex: '#008000' },
  { swtIdx: 15, armaClass: 'ColorCIV', name: 'CIV (Фиолетовый)', hex: '#660080' },
  { swtIdx: 16, armaClass: 'ColorUNKNOWN', name: 'UNKNOWN (Желтый)', hex: '#b39900' },
  { swtIdx: 21, armaClass: 'colorBLUFOR', name: 'NATO Синий', hex: '#1d4ed8' },
  { swtIdx: 22, armaClass: 'colorOPFOR', name: 'CSAT Красный', hex: '#b91c1c' },
  { swtIdx: 23, armaClass: 'colorIndependent', name: 'AAF Зеленый', hex: '#15803d' },
  { swtIdx: 24, armaClass: 'colorCivilian', name: 'Гражданский', hex: '#7e22ce' },
  { swtIdx: 25, armaClass: 'Color1_FD_F', name: 'Светло-красный', hex: '#f87171' },
  { swtIdx: 26, armaClass: 'Color2_FD_F', name: 'Темно-серый (Такт.)', hex: '#334155' },
];

function getSwtColorByIdx(idx: number): SwtColorDef {
  return SWT_COLORS.find(c => c.swtIdx === idx) || SWT_COLORS.find(c => c.swtIdx === 12)!;
}

function getMissionMarkerColorHex(colorName?: string): string {
  if (!colorName) return '#0f172a';
  const lower = colorName.toLowerCase();
  const found = SWT_COLORS.find(c => c.armaClass.toLowerCase() === lower);
  if (found) return found.hex;
  if (lower.includes('red') || lower.includes('east') || lower.includes('opfor')) return '#dc2626';
  if (lower.includes('blue') || lower.includes('west') || lower.includes('blufor')) return '#2563eb';
  if (lower.includes('green') || lower.includes('guer') || lower.includes('ind')) return '#16a34a';
  if (lower.includes('yellow') || lower.includes('unknown')) return '#eab308';
  if (lower.includes('orange')) return '#ea580c';
  if (lower.includes('white')) return '#f8fafc';
  return '#1e293b';
}

const MARKER_SIZES = [
  { label: 'Маленький (0.7)', value: 0.7 },
  { label: 'Стандарт (1.0)', value: 1.0 },
  { label: 'Большой (1.3)', value: 1.3 },
];

export interface SwtMarkerTypeDef {
  swtIdx: number;
  id: string;
  name: string;
}

export const SWT_MARKER_TYPES: SwtMarkerTypeDef[] = [
  { swtIdx: 0, id: 'hd_objective', name: '00. Цель (Перекрестие в круге)' },
  { swtIdx: 1, id: 'mil_marker', name: '01. Рубеж (Прямоугольник со штоком)' },
  { swtIdx: 2, id: 'hd_flag', name: '02. Флажок (Пункт сбора)' },
  { swtIdx: 3, id: 'hd_arrow', name: '03. Стрелка контурная' },
  { swtIdx: 4, id: 'mil_arrow2', name: '04. Стрелка залитая' },
  { swtIdx: 5, id: 'hd_ambush', name: '05. Направление / Засада' },
  { swtIdx: 6, id: 'hd_destroy', name: '06. Крест / Уничтожить' },
  { swtIdx: 7, id: 'hd_start', name: '07. Точка выхода (Старт)' },
  { swtIdx: 8, id: 'hd_end', name: '08. Точка отхода (Конец)' },
  { swtIdx: 9, id: 'hd_pickup', name: '09. Погрузка / Эвакуация' },
  { swtIdx: 10, id: 'hd_join', name: '10. Соединение' },
  { swtIdx: 11, id: 'hd_warning', name: '11. Внимание (!)' },
  { swtIdx: 12, id: 'hd_unknown', name: '12. Вопрос (?)' },
  { swtIdx: 13, id: 'hd_dot', name: '13. Точка (Малая)' },
  { swtIdx: 14, id: 'mil_circle', name: '14. Кольцо (Пустой круг)' },
  { swtIdx: 15, id: 'mil_dot', name: '15. Точка средняя' },
  { swtIdx: 16, id: 'mil_box', name: '16. Квадрат' },
  { swtIdx: 17, id: 'mil_triangle', name: '17. Треугольник' },
  { swtIdx: 18, id: 'mil_objective', name: '18. Цель (Круг с крестом)' },
  { swtIdx: 19, id: 'mil_flag', name: '19. Флаг треугольный' },
  { swtIdx: 20, id: 'mil_arrow', name: '20. Стрелка тонкая' },
  { swtIdx: 21, id: 'mil_ambush', name: '21. Засада (Елочка)' },
  { swtIdx: 22, id: 'mil_destroy', name: '22. Уничтожить (Искры)' },
  { swtIdx: 23, id: 'mil_start', name: '23. Плюс / Медпункт' },
  { swtIdx: 24, id: 'mil_end', name: '24. Точка с дугой' },
  { swtIdx: 25, id: 'mil_pickup', name: '25. Десант / Высадка' },
  { swtIdx: 26, id: 'mil_join', name: '26. Сбор (Две стрелки)' },
  { swtIdx: 27, id: 'mil_warning', name: '27. Внимание (!)' },
  { swtIdx: 28, id: 'mil_unknown', name: '28. Вопрос (?)' },
  { swtIdx: 29, id: 'mil_marker', name: '29. Ориентир' },
  { swtIdx: 30, id: 'b_unknown', name: '30. Подразделение (Рамка)' },
  { swtIdx: 31, id: 'o_unknown', name: '31. Подразделение (Ромб)' },
  { swtIdx: 32, id: 'n_unknown', name: '32. Подразделение (Квадрат)' },
  { swtIdx: 33, id: 'b_inf', name: '33. Пехота (Крест)' },
  { swtIdx: 34, id: 'o_inf', name: '34. Пехота (Ромб)' },
  { swtIdx: 35, id: 'n_inf', name: '35. Пехота (Квадрат)' },
  { swtIdx: 36, id: 'b_motor_inf', name: '36. Мотопехота' },
  { swtIdx: 37, id: 'b_mech_inf', name: '37. Мех. пехота (БМП/БТР)' },
  { swtIdx: 38, id: 'b_armor', name: '38. Бронетехника (Танк)' },
  { swtIdx: 39, id: 'b_recon', name: '39. Разведка' },
  { swtIdx: 40, id: 'b_air', name: '40. Вертолет / Авиация' },
  { swtIdx: 41, id: 'b_plane', name: '41. Самолет' },
  { swtIdx: 42, id: 'b_uav', name: '42. БПЛА (UAV)' },
  { swtIdx: 43, id: 'b_naval', name: '43. Флот / Лодка (Якорь)' },
  { swtIdx: 44, id: 'b_art', name: '44. Артиллерия' },
  { swtIdx: 45, id: 'b_mortar', name: '45. Миномет' },
  { swtIdx: 46, id: 'b_hq', name: '46. Штаб (HQ)' },
  { swtIdx: 47, id: 'b_support', name: '47. Поддержка / Инженеры' },
  { swtIdx: 48, id: 'b_maint', name: '48. Ремонт' },
  { swtIdx: 49, id: 'b_med', name: '49. Медицина' },
  { swtIdx: 50, id: 'b_service', name: '50. Снабжение' },
  { swtIdx: 51, id: 'b_antiair', name: '51. ПВО (Зенитка)' },
  { swtIdx: 52, id: 'b_installation', name: '52. База / Укрепление' },
  { swtIdx: 53, id: 'o_motor_inf', name: '53. Мотопехота (Ромб)' },
  { swtIdx: 54, id: 'o_mech_inf', name: '54. Мех. пехота (Ромб)' },
  { swtIdx: 55, id: 'o_armor', name: '55. Броня (Ромб)' },
  { swtIdx: 56, id: 'o_recon', name: '56. Разведка (Ромб)' },
  { swtIdx: 57, id: 'o_air', name: '57. Вертолет (Ромб)' },
  { swtIdx: 58, id: 'o_plane', name: '58. Самолет (Ромб)' },
  { swtIdx: 59, id: 'o_uav', name: '59. БПЛА (Ромб)' },
  { swtIdx: 60, id: 'o_naval', name: '60. Лодка (Ромб)' },
  { swtIdx: 61, id: 'o_art', name: '61. Артиллерия (Ромб)' },
  { swtIdx: 62, id: 'o_mortar', name: '62. Миномет (Ромб)' },
  { swtIdx: 63, id: 'o_hq', name: '63. Штаб (Ромб)' },
  { swtIdx: 64, id: 'o_support', name: '64. Поддержка (Ромб)' },
  { swtIdx: 65, id: 'o_maint', name: '65. Ремонт (Ромб)' },
  { swtIdx: 66, id: 'o_med', name: '66. Медицина (Ромб)' },
  { swtIdx: 67, id: 'o_service', name: '67. Снабжение (Ромб)' },
  { swtIdx: 68, id: 'o_antiair', name: '68. ПВО (Ромб)' },
  { swtIdx: 69, id: 'n_motor_inf', name: '69. Мотопехота (Квадрат)' },
  { swtIdx: 70, id: 'n_mech_inf', name: '70. Мех. пехота (Квадрат)' },
  { swtIdx: 71, id: 'n_armor', name: '71. Броня (Квадрат)' },
  { swtIdx: 72, id: 'n_recon', name: '72. Разведка (Квадрат)' },
  { swtIdx: 73, id: 'n_air', name: '73. Вертолет (Квадрат)' },
  { swtIdx: 74, id: 'n_art', name: '74. Артиллерия (Квадрат)' },
  ...Array.from({ length: 20 }, (_, i) => ({
    swtIdx: 75 + i,
    id: `group_${Math.min(11, i)}`,
    name: `${75 + i}. Тактический знак / Группа #${75 + i}`,
  })),
  { swtIdx: 95, id: 'Contact_circle1', name: '95. Круглый значок (ПТ/Сектор)' },
  { swtIdx: 96, id: 'Contact_circle2', name: '96. Круглый значок (Позиция)' },
  { swtIdx: 97, id: 'Contact_circle3', name: '97. Круглый значок (Огонь)' },
  { swtIdx: 98, id: 'Contact_circle4', name: '98. Круглый значок (Техника)' },
  { swtIdx: 99, id: 'loc_radio', name: '99. Круглый значок (Связь)' },
  { swtIdx: 100, id: 'loc_search', name: '100. Круглый значок (Наблюдение)' },
  { swtIdx: 101, id: 'loc_defend', name: '101. Круглый значок (Укреп)' },
  { swtIdx: 102, id: 'loc_Bunker', name: '102. Круглый значок (Бункер)' },
  { swtIdx: 103, id: 'KIA', name: '103. Череп (KIA / Опасность)' },
  { swtIdx: 106, id: 'loc_Cross', name: '106. Малый крест' },
  { swtIdx: 107, id: 'mil_triangle', name: '107. Пустой треугольник (ОП)' },
  { swtIdx: 108, id: 'Minefield', name: '108. Минное поле (Треугольник)' },
  { swtIdx: 109, id: 'loc_Fortress', name: '109. Бункер / ДОТ' },
  { swtIdx: 110, id: 'loc_Box', name: '110. Ящик / Склад' },
  { swtIdx: 111, id: 'b_inf', name: '111. Позиция отделения (Малая)' },
  { swtIdx: 112, id: 'b_inf', name: '112. Рубеж отделения (Широкий)' },
];

export interface SwtPlanMarker {
  id: string;
  text: string;
  x: number;
  y: number;
  swtTypeIndex: number;
  swtColorIndex: number;
  color: string;
  angle: number;
  scaleX: number;
  scaleY: number;
  polyCoords: number[];
}

export interface OcapMapConfig {
  name?: string;
  worldname?: string;
  worldSize: number;
  imageSize: number;
  multiplier: number;
  maxZoom: number;
}

function calcMaxZoomFromImageSize(imageSize: number, fallbackZoom = 6): number {
  if (!imageSize || imageSize <= 256) return fallbackZoom;
  const pow2Size = Math.pow(2, Math.ceil(Math.log2(imageSize)));
  return Math.max(1, Math.round(Math.log2(pow2Size / 256)));
}

const KNOWN_MAPS: Record<string, OcapMapConfig> = {
  altis: { worldSize: 30720, imageSize: 30720, multiplier: 1, maxZoom: 7 },
  chernarus: { worldSize: 15360, imageSize: 16384, multiplier: 1, maxZoom: 6 },
  chernarus_summer: { worldSize: 15360, imageSize: 16384, multiplier: 1, maxZoom: 6 },
  chernarus_winter: { worldSize: 15360, imageSize: 16384, multiplier: 1, maxZoom: 6 },
  cup_chernarus_a3: { worldSize: 15360, imageSize: 16384, multiplier: 1, maxZoom: 6 },
  takistan: { worldSize: 12800, imageSize: 16384, multiplier: 1.28, maxZoom: 6 },
  malden: { worldSize: 12800, imageSize: 16384, multiplier: 1.28, maxZoom: 6 },
  tanoa: { worldSize: 15360, imageSize: 16384, multiplier: 1, maxZoom: 6 },
  beketov: { worldSize: 20480, imageSize: 16384, multiplier: 0.8, maxZoom: 6 },
  lythium: { worldSize: 20480, imageSize: 16384, multiplier: 0.8, maxZoom: 6 },
  lithium: { worldSize: 20480, imageSize: 16384, multiplier: 0.8, maxZoom: 6 },
  napf: { worldSize: 20481, imageSize: 16384, multiplier: 0.799960939407256, maxZoom: 6 },
  rosche: { worldSize: 15360, imageSize: 16384, multiplier: 1, maxZoom: 6 },
  wl_rosche: { worldSize: 15360, imageSize: 16384, multiplier: 1, maxZoom: 6 },
  podagorsk: { worldSize: 20480, imageSize: 16384, multiplier: 0.8, maxZoom: 6 },
  fdf_isle1_a: { worldSize: 20480, imageSize: 16384, multiplier: 0.8, maxZoom: 6 },
  celle2: { worldSize: 12288, imageSize: 16384, multiplier: 1.333333, maxZoom: 6 },
  mbg_celle2: { worldSize: 12288, imageSize: 16384, multiplier: 1.333333, maxZoom: 6 },
  fallujah: { worldSize: 10240, imageSize: 16384, multiplier: 1.6, maxZoom: 6 },
  reshmaan: { worldSize: 20480, imageSize: 16384, multiplier: 0.8, maxZoom: 6 },
  vt7: { worldSize: 18000, imageSize: 16384, multiplier: 0.910222, maxZoom: 6 },
  brf_sumava: { worldSize: 12288, imageSize: 16384, multiplier: 1.333333, maxZoom: 6 },
  sumava: { worldSize: 12288, imageSize: 16384, multiplier: 1.333333, maxZoom: 6 },
  korsac: { worldSize: 16384, imageSize: 16384, multiplier: 1, maxZoom: 6 },
};

function detectFallbackConfig(mission: MissionInfo): OcapMapConfig {
  const rawName = (mission.worldName || '').toLowerCase().trim();
  if (KNOWN_MAPS[rawName]) return KNOWN_MAPS[rawName];
  for (const [key, cfg] of Object.entries(KNOWN_MAPS)) {
    if (rawName.includes(key)) return cfg;
  }
  let maxCoord = 0;
  mission.groups.forEach(g =>
      g.units.forEach(u => {
        if (u.position.length >= 3) maxCoord = Math.max(maxCoord, u.position[0], u.position[2]);
      })
  );
  mission.markers.forEach(m => {
    if (m.position.length >= 3) maxCoord = Math.max(maxCoord, m.position[0], m.position[2]);
  });
  if (maxCoord > 20485) return KNOWN_MAPS.altis;
  if (maxCoord > 15360) return KNOWN_MAPS.napf;
  if (maxCoord > 12800) return KNOWN_MAPS.chernarus;
  return KNOWN_MAPS.takistan;
}

function getRotatedRectLatLngs(
    centerX: number,
    centerY: number,
    widthA: number,
    heightB: number,
    angleDeg: number = 0
): [number, number][] {
  const rad = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const corners = [
    [-widthA, -heightB],
    [widthA, -heightB],
    [widthA, heightB],
    [-widthA, heightB],
  ];

  return corners.map(([dx, dy]) => {
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    return [centerY + ry, centerX + rx];
  });
}

function getRotatedEllipseLatLngs(
    centerX: number,
    centerY: number,
    widthA: number,
    heightB: number,
    angleDeg: number = 0
): [number, number][] {
  const rad = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const pts: [number, number][] = [];

  for (let i = 0; i < 36; i++) {
    const theta = (i * 2 * Math.PI) / 36;
    const dx = widthA * Math.cos(theta);
    const dy = heightB * Math.sin(theta);
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    pts.push([centerY + ry, centerX + rx]);
  }
  return pts;
}

function renderMarkerHtml(
    typeIdxOrName: number | string,
    colorHex: string,
    text: string,
    angle: number = 0,
    scale: number = 1
): string {
  const safeText = (text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const sizePx = Math.round(24 * scale);

  if (typeof typeIdxOrName === 'string') {
    const lower = typeIdxOrName.toLowerCase();
    const isFullColorPngMarker =
        lower.startsWith('flag_') ||
        lower.startsWith('rhs_flag') ||
        lower.startsWith('lop_flag') ||
        lower.startsWith('40th_flag') ||
        lower.startsWith('rhssaf_flag') ||
        lower.startsWith('faction_') ||
        lower.startsWith('usp_marker') ||
        lower.startsWith('loc_');

    if (isFullColorPngMarker) {
      return `<div style="transform:translate(-${Math.round(sizePx / 2)}px, -50%);display:flex;align-items:center;gap:4px;white-space:nowrap;user-select:none;">
        <img src="/api/assets/icon/${encodeURIComponent(typeIdxOrName)}" style="width:${sizePx}px;height:${sizePx}px;object-fit:contain;transform:rotate(${angle}deg);filter:drop-shadow(0 1px 2px rgba(0,0,0,0.8));" onerror="this.style.display='none'" />
        ${
          safeText
              ? `<span style="color:${colorHex};background:rgba(255,255,255,0.85);padding:0px 5px;border-radius:3px;font-weight:bold;font-size:${Math.round(12 * scale)}px;border:1px solid rgba(0,0,0,0.25);">${safeText}</span>`
              : ''
      }
      </div>`;
    }
  }

  let idx = typeof typeIdxOrName === 'number' ? typeIdxOrName : -1;
  if (typeof typeIdxOrName === 'string') {
    const lower = typeIdxOrName.toLowerCase();
    const found = SWT_MARKER_TYPES.find(t => t.id.toLowerCase() === lower);
    if (found) idx = found.swtIdx;
    else if (lower.includes('inf')) idx = 33;
    else if (lower.includes('motor')) idx = 36;
    else if (lower.includes('mech')) idx = 37;
    else if (lower.includes('armor')) idx = 38;
    else if (lower.includes('recon')) idx = 39;
    else if (lower.includes('air') || lower.includes('heli')) idx = 40;
    else if (lower.includes('plane')) idx = 41;
    else if (lower.includes('art')) idx = 44;
    else if (lower.includes('mortar')) idx = 45;
    else if (lower.includes('hq')) idx = 46;
    else if (lower.includes('med')) idx = 49;
    else if (lower.includes('objective')) idx = 0;
    else if (lower.includes('flag')) idx = 2;
    else if (lower.includes('arrow')) idx = 4;
    else if (lower.includes('warning') || lower.includes('mine')) idx = 108;
    else idx = 15;
  }

  let inner = '';
  if (idx === 0 || idx === 18) {
    inner = `<circle cx="14" cy="14" r="9" fill="none" stroke="${colorHex}" stroke-width="2.4"/>
      <line x1="7" y1="7" x2="21" y2="21" stroke="${colorHex}" stroke-width="2.2"/>
      <line x1="21" y1="7" x2="7" y2="21" stroke="${colorHex}" stroke-width="2.2"/>`;
  } else if (idx === 1 || idx === 29) {
    inner = `<rect x="7" y="5" width="7" height="12" fill="none" stroke="${colorHex}" stroke-width="2.2"/>
      <line x1="7" y1="17" x2="7" y2="25" stroke="${colorHex}" stroke-width="2.2"/>`;
  } else if (idx === 2 || idx === 19) {
    inner = `<path d="M8 24V5h12l-3 5 3 5H8" fill="none" stroke="${colorHex}" stroke-width="2.2"/>`;
  } else if (idx === 3 || idx === 20) {
    inner = `<path d="M14 4L7 12h4v12h6V12h4L14 4z" fill="none" stroke="${colorHex}" stroke-width="2.2"/>`;
  } else if (idx === 4) {
    inner = `<path d="M14 3L6 12h5v13h6V12h5L14 3z" fill="${colorHex}" stroke="#000" stroke-width="1"/>`;
  } else if (idx === 5 || idx === 21) {
    inner = `<line x1="4" y1="14" x2="20" y2="14" stroke="${colorHex}" stroke-width="2.4"/>
      <line x1="20" y1="6" x2="20" y2="22" stroke="${colorHex}" stroke-width="2.5"/>
      <path d="M14 10l6 4-6 4" fill="none" stroke="${colorHex}" stroke-width="2.2"/>`;
  } else if (idx === 6 || idx === 23) {
    inner = `<line x1="14" y1="4" x2="14" y2="24" stroke="${colorHex}" stroke-width="2.4"/>
      <line x1="4" y1="14" x2="24" y2="14" stroke="${colorHex}" stroke-width="2.4"/>`;
  } else if (idx === 7 || idx === 8 || idx === 9 || idx === 10 || idx === 24 || idx === 25 || idx === 26) {
    inner = `<path d="M7 14a7 7 0 1 0 14 0" fill="none" stroke="${colorHex}" stroke-width="2.3"/>
      <line x1="14" y1="3" x2="14" y2="16" stroke="${colorHex}" stroke-width="2.3"/>
      <path d="M10 8l4-5 4 5" fill="none" stroke="${colorHex}" stroke-width="2.2"/>`;
  } else if (idx === 11 || idx === 27) {
    inner = `<circle cx="14" cy="14" r="9.5" fill="none" stroke="${colorHex}" stroke-width="2.3"/>
      <text x="14" y="19" text-anchor="middle" fill="${colorHex}" font-size="15" font-weight="bold">!</text>`;
  } else if (idx === 12 || idx === 28) {
    inner = `<circle cx="14" cy="14" r="9.5" fill="none" stroke="${colorHex}" stroke-width="2.3"/>
      <text x="14" y="19" text-anchor="middle" fill="${colorHex}" font-size="14" font-weight="bold">?</text>`;
  } else if (idx === 13 || idx === 15) {
    inner = `<circle cx="14" cy="14" r="4.5" fill="${colorHex}" stroke="#fff" stroke-width="1.5"/>`;
  } else if (idx === 14) {
    inner = `<circle cx="14" cy="14" r="9" fill="none" stroke="${colorHex}" stroke-width="2.5"/>`;
  } else if (idx === 16) {
    inner = `<rect x="9" y="9" width="10" height="10" fill="${colorHex}" stroke="#fff" stroke-width="1.2"/>`;
  } else if (idx === 17 || idx === 107) {
    inner = `<polygon points="14,5 5,22 23,22" fill="none" stroke="${colorHex}" stroke-width="2.2"/>`;
  } else if (idx === 22) {
    inner = `<line x1="5" y1="5" x2="23" y2="23" stroke="${colorHex}" stroke-width="2.3"/>
      <line x1="23" y1="5" x2="5" y2="23" stroke="${colorHex}" stroke-width="2.3"/>
      <line x1="14" y1="3" x2="14" y2="25" stroke="${colorHex}" stroke-width="2"/>`;
  } else if (idx >= 30 && idx <= 94) {
    const isDiamond = idx === 31 || idx === 34 || (idx >= 53 && idx <= 68);
    const isSquare = idx === 32 || idx === 35 || (idx >= 69 && idx <= 74);

    let frame = `<rect x="3" y="6" width="22" height="16" fill="${colorHex}" fill-opacity="0.82" stroke="#0f172a" stroke-width="2"/>`;
    if (isDiamond) {
      frame = `<polygon points="14,2 26,14 14,26 2,14" fill="${colorHex}" fill-opacity="0.82" stroke="#0f172a" stroke-width="2"/>`;
    } else if (isSquare) {
      frame = `<rect x="5" y="5" width="18" height="18" fill="${colorHex}" fill-opacity="0.82" stroke="#0f172a" stroke-width="2"/>`;
    }

    let sym = '';
    const mod = idx % 15;
    if ([33, 34, 35, 75].includes(idx) || mod === 3) {
      sym = `<line x1="4" y1="6" x2="24" y2="22" stroke="#0f172a" stroke-width="2"/><line x1="24" y1="6" x2="4" y2="22" stroke="#0f172a" stroke-width="2"/>`;
    } else if ([36, 53, 69].includes(idx) || mod === 6) {
      sym = `<line x1="4" y1="6" x2="24" y2="22" stroke="#0f172a" stroke-width="1.8"/><line x1="24" y1="6" x2="4" y2="22" stroke="#0f172a" stroke-width="1.8"/><line x1="14" y1="6" x2="14" y2="22" stroke="#0f172a" stroke-width="1.8"/>`;
    } else if ([37, 54, 70].includes(idx) || mod === 7) {
      sym = `<line x1="4" y1="6" x2="24" y2="22" stroke="#0f172a" stroke-width="1.6"/><line x1="24" y1="6" x2="4" y2="22" stroke="#0f172a" stroke-width="1.6"/><ellipse cx="14" cy="14" rx="6.5" ry="3.8" fill="none" stroke="#0f172a" stroke-width="1.8"/>`;
    } else if ([38, 55, 71].includes(idx) || mod === 8) {
      sym = `<ellipse cx="14" cy="14" rx="7" ry="4" fill="none" stroke="#0f172a" stroke-width="2"/>`;
    } else if ([39, 56, 72].includes(idx) || mod === 9) {
      sym = `<line x1="4" y1="22" x2="24" y2="6" stroke="#0f172a" stroke-width="2.2"/>`;
    } else if ([40, 57, 73].includes(idx) || mod === 10) {
      sym = `<polygon points="7,10 21,18 21,10 7,18" fill="#0f172a"/>`;
    } else if ([44, 61, 74].includes(idx) || mod === 14) {
      sym = `<circle cx="14" cy="14" r="3.5" fill="#0f172a"/>`;
    } else if ([45, 62].includes(idx)) {
      sym = `<circle cx="14" cy="17" r="2.5" fill="#0f172a"/><line x1="14" y1="15" x2="14" y2="8" stroke="#0f172a" stroke-width="2"/>`;
    } else if ([46, 63].includes(idx)) {
      sym = `<line x1="4" y1="11" x2="24" y2="11" stroke="#0f172a" stroke-width="2"/>`;
    } else if ([49, 66].includes(idx)) {
      sym = `<line x1="14" y1="7" x2="14" y2="21" stroke="#0f172a" stroke-width="2.2"/><line x1="6" y1="14" x2="22" y2="14" stroke="#0f172a" stroke-width="2.2"/>`;
    }
    inner = `${frame}${sym}`;
  } else if (idx === 103) {
    inner = `<circle cx="14" cy="12" r="7" fill="${colorHex}" stroke="#0f172a" stroke-width="1.5"/>
      <circle cx="11.5" cy="11" r="1.5" fill="#fff"/><circle cx="16.5" cy="11" r="1.5" fill="#fff"/>
      <rect x="11" y="17" width="6" height="4" fill="${colorHex}" stroke="#0f172a" stroke-width="1.2"/>`;
  } else if (idx === 108) {
    inner = `<polygon points="14,4 4,23 24,23" fill="none" stroke="${colorHex}" stroke-width="2"/>
      <circle cx="14" cy="13" r="1.8" fill="${colorHex}"/>
      <circle cx="10" cy="19" r="1.8" fill="${colorHex}"/>
      <circle cx="18" cy="19" r="1.8" fill="${colorHex}"/>`;
  } else {
    inner = `<circle cx="14" cy="14" r="9" fill="none" stroke="${colorHex}" stroke-width="2.2"/>
      <circle cx="14" cy="14" r="3" fill="${colorHex}"/>`;
  }

  return `<div style="transform:translate(-${Math.round(sizePx / 2)}px, -50%);display:flex;align-items:center;gap:4px;white-space:nowrap;user-select:none;">
    <svg width="${sizePx}" height="${sizePx}" viewBox="0 0 28 28" style="transform:rotate(${angle}deg);filter:drop-shadow(0 1px 2px rgba(0,0,0,0.65));overflow:visible;">
      ${inner}
    </svg>
    ${
      safeText
          ? `<span style="color:${colorHex};background:rgba(255,255,255,0.82);padding:0px 5px;border-radius:3px;font-weight:bold;font-size:${Math.round(12 * scale)}px;border:1px solid rgba(0,0,0,0.25);box-shadow:0 1px 2px rgba(0,0,0,0.4);">${safeText}</span>`
          : ''
  }
  </div>`;
}

export default function App() {
  const [mission, setMission] = useState<MissionInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'booking' | 'map' | 'briefing' | 'scripts' | 'validation'>('booking');
  const [validationFilter, setValidationFilter] = useState<'ALL' | 'Error' | 'Warning' | 'Ok'>('ALL');
  const [selectedScriptPath, setSelectedScriptPath] = useState<string>('');
  const [selectedSide, setSelectedSide] = useState<string>('');

  const [assetNames, setAssetNames] = useState<Record<string, string>>({});

  const [unitAssignments, setUnitAssignments] = useState<Record<number, string>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<number, boolean>>({});

  const [inspectedUnit, setInspectedUnit] = useState<SquadUnit | null>(null);
  const [inspectedVehicle, setInspectedVehicle] = useState<MissionVehicle | null>(null);

  const [planMarkers, setPlanMarkers] = useState<SwtPlanMarker[]>([]);
  const [activeColorSwtIdx, setActiveColorSwtIdx] = useState<number>(12);
  const [activeTypeSwtIdx, setActiveTypeSwtIdx] = useState<number>(33);
  const [activeMarkerScale, setActiveMarkerScale] = useState<number>(1.0);
  const [activeMarkerAngle, setActiveMarkerAngle] = useState<number>(0);
  const [swtArrayText, setSwtArrayText] = useState('');

  const [popupModal, setPopupModal] = useState<{
    x: number;
    y: number;
    screenX: number;
    screenY: number;
    text: string;
    swtTypeIdx: number;
    swtColorIdx: number;
    scale: number;
    angle: number;
  } | null>(null);

  const [mapConfig, setMapConfig] = useState<OcapMapConfig>(KNOWN_MAPS.altis);
  const [tileAlignMode, setTileAlignMode] = useState<'worldSize' | 'imageSize' | 'tms'>('worldSize');
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

  const bookingTableRef = useRef<HTMLDivElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const planLayerGroupRef = useRef<L.LayerGroup | null>(null);

  const hoveredMarkerIdRef = useRef<string | null>(null);
  const activeColorRef = useRef(activeColorSwtIdx);
  useEffect(() => {
    activeColorRef.current = activeColorSwtIdx;
  }, [activeColorSwtIdx]);

  useEffect(() => {
    fetch('/api/assets/catalog')
        .then(r => (r.ok ? r.json() : null))
        .then(dict => {
          if (dict) setAssetNames(dict);
        })
        .catch(() => {});

    fetch('/api/mission/current')
        .then(r => (r.ok ? r.json() : null))
        .then((data: MissionInfo | null) => {
          if (data) initMissionState(data);
        })
        .catch(() => {});
  }, []);

  const formatClassTitle = (cls?: string) => {
    if (!cls) return '—';
    const ru = assetNames[cls] || assetNames[cls.toLowerCase()];
    return ru ? `${ru} (${cls})` : cls;
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && hoveredMarkerIdRef.current) {
        const tag = (document.activeElement?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        const targetId = hoveredMarkerIdRef.current;
        hoveredMarkerIdRef.current = null;
        setPlanMarkers(prev => prev.filter(m => m.id !== targetId));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const initMissionState = (data: MissionInfo) => {
    setMission(data);
    const sides = Array.from(new Set(data.groups.map(g => g.side)));
    if (sides.length > 0) setSelectedSide(sides[0]);
    setUnitAssignments({});
    setExpandedGroups({});
    setPopupModal(null);

    const fallbackCfg = detectFallbackConfig(data);
    setMapConfig(fallbackCfg);
  };

  useEffect(() => {
    if (!mission) return;
    const fallbackCfg = detectFallbackConfig(mission);
    setMapConfig(fallbackCfg);

    const worldKey = (mission.worldName || 'altis').toLowerCase().trim();
    fetch(`/api/maps/${worldKey}/map.json`)
        .then(r => (r.ok ? r.json() : null))
        .then((cfg: any) => {
          if (cfg && cfg.worldSize) {
            const wSize = Number(cfg.worldSize);
            const imgSize = Number(cfg.imageSize || wSize);
            const mult = Number(cfg.multiplier || imgSize / wSize || 1);
            const computedMaxZoom =
                cfg.maxZoom !== undefined
                    ? Number(cfg.maxZoom)
                    : calcMaxZoomFromImageSize(imgSize, fallbackCfg.maxZoom);

            setMapConfig({
              worldSize: wSize,
              imageSize: imgSize,
              multiplier: mult,
              maxZoom: computedMaxZoom,
              name: cfg.name,
              worldname: cfg.worldname || worldKey,
            });
          }
        })
        .catch(() => {});
  }, [mission]);

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

  const sideGroups = useMemo(() => {
    if (!mission) return [];
    return mission.groups.filter(g => g.side === selectedSide);
  }, [mission, selectedSide]);

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

  const assignSingleUnit = (unitId: number, clanTag: string) => {
    setUnitAssignments(prev => ({
      ...prev,
      [unitId]: clanTag.trim(),
    }));
  };

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

  const exportSwtArray = () => {
    const swtItems = planMarkers.map(m => {
      const pos =
          m.swtTypeIndex === -4
              ? [Number(m.x.toFixed(2)), Number(m.y.toFixed(2)), 0]
              : [Number(m.x.toFixed(2)), Number(m.y.toFixed(2))];

      let scaleField: number | number[] = 1;
      if (m.swtTypeIndex === -2 || m.swtTypeIndex === -3) {
        scaleField = [Number(m.scaleX.toFixed(2)), Number(m.scaleY.toFixed(2))];
      } else if (m.swtTypeIndex === -4) {
        scaleField = 0;
      } else {
        scaleField = Number(m.scaleX.toFixed(2));
      }

      const polyField =
          m.swtTypeIndex === -4 && m.polyCoords.length > 0
              ? m.polyCoords.map(n => Number(n.toFixed(2)))
              : [];

      return JSON.stringify([
        m.text || '',
        pos,
        m.swtTypeIndex,
        m.swtColorIndex,
        Number(m.angle.toFixed(2)),
        scaleField,
        '',
        polyField,
      ]);
    });

    const result = `[${swtItems.join(',')}]`;
    setSwtArrayText(result);
    navigator.clipboard.writeText(result);
  };

  const importSwtArray = () => {
    if (!swtArrayText.trim()) return;
    try {
      const parsed = JSON.parse(swtArrayText.trim());
      if (!Array.isArray(parsed)) throw new Error('Ожидался JSON-массив SWT.');

      const imported: SwtPlanMarker[] = [];
      for (const item of parsed) {
        if (!Array.isArray(item) || item.length < 4) continue;
        const text = String(item[0] ?? '');
        const pos = Array.isArray(item[1]) ? item[1] : [0, 0];
        const x = Number(pos[0] ?? 0);
        const y = Number(pos[1] ?? 0);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

        const typeIdx = Number(item[2] ?? 0);
        const colorIdx = Number(item[3] ?? 12);
        const angle = Number(item[4] ?? 0);
        const sizeOrDims = item[5];
        const rawPoly = Array.isArray(item[7]) ? item[7].map(Number) : [];
        const cleanPoly: number[] = [];
        for (let i = 0; i + 1 < rawPoly.length; i += 2) {
          if (Number.isFinite(rawPoly[i]) && Number.isFinite(rawPoly[i + 1])) {
            cleanPoly.push(rawPoly[i], rawPoly[i + 1]);
          }
        }

        let scaleX = 1;
        let scaleY = 1;
        if (Array.isArray(sizeOrDims) && sizeOrDims.length >= 2) {
          scaleX = Number(sizeOrDims[0] ?? 25);
          scaleY = Number(sizeOrDims[1] ?? 25);
        } else if (typeof sizeOrDims === 'number' && sizeOrDims > 0) {
          scaleX = sizeOrDims;
          scaleY = sizeOrDims;
        }

        const colorDef = getSwtColorByIdx(colorIdx);
        imported.push({
          id: crypto.randomUUID(),
          text,
          x,
          y,
          swtTypeIndex: typeIdx,
          swtColorIndex: colorIdx,
          color: colorDef.hex,
          angle: Number.isFinite(angle) ? angle : 0,
          scaleX: Number.isFinite(scaleX) ? scaleX : 1,
          scaleY: Number.isFinite(scaleY) ? scaleY : 1,
          polyCoords: cleanPoly,
        });
      }

      if (imported.length === 0) {
        alert('Не удалось распознать маркеры в массиве.');
        return;
      }
      setPlanMarkers(prev => [...prev, ...imported]);
    } catch (e) {
      alert('Ошибка разбора массива SWT: ' + e);
    }
  };

  useEffect(() => {
    if (activeTab !== 'map' || !mission || !mapContainerRef.current) return;

    if (leafletMapRef.current) {
      leafletMapRef.current.remove();
      leafletMapRef.current = null;
    }

    const currentWorldSize = mapConfig.worldSize;
    const maxZoom = mapConfig.maxZoom;
    const multiplier = mapConfig.multiplier || 1;

    const scale = Math.pow(2, maxZoom) / multiplier;
    const factor = 1 / scale;
    const offsetY = tileAlignMode === 'imageSize' ? 256 : currentWorldSize * factor;

    const armaCrs = L.extend({}, L.CRS.Simple, {
      transformation: new L.Transformation(factor, 0, -factor, offsetY),
    });

    const map = L.map(mapContainerRef.current, {
      crs: armaCrs,
      minZoom: 0,
      maxZoom: maxZoom + 2,
      zoomSnap: 0.5,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
    });
    leafletMapRef.current = map;

    const bounds: L.LatLngBoundsExpression = [
      [0, 0],
      [currentWorldSize, currentWorldSize],
    ];

    const worldKey = (mission.worldName || 'altis').toLowerCase().trim();
    L.tileLayer(`/api/maps/${worldKey}/{z}/{x}/{y}.png`, {
      minZoom: 0,
      maxZoom: maxZoom + 2,
      maxNativeZoom: maxZoom,
      tileSize: 256,
      noWrap: true,
      bounds: bounds,
      tms: tileAlignMode === 'tms',
    }).addTo(map);

    const grid1kmGroup = L.layerGroup().addTo(map);
    const grid100mGroup = L.layerGroup();

    L.rectangle(bounds, {
      color: '#475569',
      weight: 1.5,
      fill: false,
      interactive: false,
    }).addTo(grid1kmGroup);

    for (let i = 0; i <= currentWorldSize; i += 1000) {
      L.polyline([[0, i], [currentWorldSize, i]], {
        color: 'rgba(0, 0, 0, 0.28)',
        weight: 1,
        interactive: false,
      }).addTo(grid1kmGroup);

      L.polyline([[i, 0], [i, currentWorldSize]], {
        color: 'rgba(0, 0, 0, 0.28)',
        weight: 1,
        interactive: false,
      }).addTo(grid1kmGroup);
    }

    const updateFineGrid = () => {
      grid100mGroup.clearLayers();
      if (map.getZoom() < maxZoom - 2) {
        if (map.hasLayer(grid100mGroup)) map.removeLayer(grid100mGroup);
        return;
      }
      if (!map.hasLayer(grid100mGroup)) grid100mGroup.addTo(map);

      const viewBounds = map.getBounds();
      const startX = Math.max(0, Math.floor(viewBounds.getWest() / 100) * 100);
      const endX = Math.min(currentWorldSize, Math.ceil(viewBounds.getEast() / 100) * 100);
      const startY = Math.max(0, Math.floor(viewBounds.getSouth() / 100) * 100);
      const endY = Math.min(currentWorldSize, Math.ceil(viewBounds.getNorth() / 100) * 100);

      for (let x = startX; x <= endX; x += 100) {
        if (x % 1000 === 0) continue;
        L.polyline([[startY, x], [endY, x]], {
          color: 'rgba(0, 0, 0, 0.15)',
          weight: 0.8,
          interactive: false,
        }).addTo(grid100mGroup);
      }
      for (let y = startY; y <= endY; y += 100) {
        if (y % 1000 === 0) continue;
        L.polyline([[y, startX], [y, endX]], {
          color: 'rgba(0, 0, 0, 0.15)',
          weight: 0.8,
          interactive: false,
        }).addTo(grid100mGroup);
      }
    };

    map.on('zoomend moveend', updateFineGrid);
    map.fitBounds(bounds);

    mission.markers.forEach(m => {
      if (!m.position || m.position.length < 3) return;
      const x = Number(m.position[0]);
      const y = Number(m.position[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      const angle = Number((m as any).angle ?? (m as any).Angle ?? (m as any).dir ?? 0);
      const colorHex = getMissionMarkerColorHex(m.colorName);
      const alpha = m.alpha ?? 1;

      if (m.markerType === 'RECTANGLE') {
        const corners = getRotatedRectLatLngs(x, y, m.widthA || 1, m.heightB || 1, angle);
        L.polygon(corners, {
          color: colorHex,
          weight: 2,
          fillColor: colorHex,
          fillOpacity: 0.25 * alpha,
          interactive: false,
        }).addTo(map);
      } else if (m.markerType === 'ELLIPSE') {
        const pts = getRotatedEllipseLatLngs(x, y, m.widthA || 1, m.heightB || 1, angle);
        L.polygon(pts, {
          color: colorHex,
          weight: 2,
          fillColor: colorHex,
          fillOpacity: 0.25 * alpha,
          interactive: false,
        }).addTo(map);
      } else {
        const iconTypeLower = (m.iconType || '').toLowerCase();
        if ((iconTypeLower === 'empty' || iconTypeLower === '') && !m.text) return;

        const icon = L.divIcon({
          className: '',
          iconSize: [0, 0],
          iconAnchor: [0, 0],
          html: renderMarkerHtml(m.iconType || 'hd_dot', colorHex, m.text, angle, 0.85),
        });
        L.marker([y, x], { icon, interactive: false }).addTo(map);
      }
    });

    mission.groups.forEach(g => {
      const leader = g.units[0];
      if (!leader || !leader.position || leader.position.length < 3) return;
      const x = Number(leader.position[0]);
      const y = Number(leader.position[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      const sideColor =
          g.side === 'West' ? '#3b82f6' : g.side === 'East' ? '#ef4444' : '#22c55e';

      const icon = L.divIcon({
        className: '',
        iconSize: [0, 0],
        iconAnchor: [0, 0],
        html: `<div style="transform:translate(-50%, -50%);background:${sideColor};color:#fff;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:bold;border:1px solid #fff;white-space:nowrap;box-shadow:0 2px 4px rgba(0,0,0,0.6);">
          ${g.callSign} (${g.units.length})
        </div>`,
      });
      L.marker([y, x], { icon })
          .bindPopup(`<b>[${g.side}] ${g.callSign}</b><br/>${g.squadDescription || 'Пехота'}<br/>Слотов: ${g.units.length}`)
          .addTo(map);
    });

    mission.vehicles.forEach(v => {
      if (!v.position || v.position.length < 3) return;
      const x = Number(v.position[0]);
      const y = Number(v.position[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      const marker = L.circleMarker([y, x], {
        radius: 5,
        fillColor: v.cargo.hasAnyCargo ? '#f59e0b' : '#94a3b8',
        color: '#0f172a',
        weight: 1.5,
        fillOpacity: 0.95,
      }).addTo(map);

      marker.bindTooltip(`${v.vehicleClass}${v.cargo.hasAnyCargo ? ' (Есть БК/Груз)' : ''}`);
      marker.on('click', e => {
        L.DomEvent.stopPropagation(e);
        setInspectedVehicle(v);
      });
    });

    const planLayer = L.layerGroup().addTo(map);
    planLayerGroupRef.current = planLayer;

    const previewLayer = L.layerGroup().addTo(map);

    map.on('dblclick', (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e);
      if (!e.latlng || !Number.isFinite(e.latlng.lat) || !Number.isFinite(e.latlng.lng)) return;

      const containerRect = mapContainerRef.current?.getBoundingClientRect();
      const screenX = e.originalEvent.clientX - (containerRect?.left ?? 0);
      const screenY = e.originalEvent.clientY - (containerRect?.top ?? 0);

      setPopupModal({
        x: Number(e.latlng.lng.toFixed(2)),
        y: Number(e.latlng.lat.toFixed(2)),
        screenX: Math.max(10, Math.min(screenX, (containerRect?.width ?? 800) - 310)),
        screenY: Math.max(10, Math.min(screenY, (containerRect?.height ?? 600) - 360)),
        text: '',
        swtTypeIdx: activeTypeSwtIdx,
        swtColorIdx: activeColorRef.current,
        scale: activeMarkerScale,
        angle: activeMarkerAngle,
      });
    });

    let drawMode: 'freeLine' | 'straightLine' | 'rectStrip' | 'ellipse' | null = null;
    let startPt: { x: number; y: number } | null = null;
    let currentPt: { x: number; y: number } | null = null;
    let freeCoords: number[] = [];
    let stripHalfWidth = 18;

    const redrawPreview = () => {
      previewLayer.clearLayers();
      if (!drawMode || !startPt || !currentPt) return;
      const colorHex = getSwtColorByIdx(activeColorRef.current).hex;

      if (drawMode === 'freeLine' || drawMode === 'straightLine') {
        const latlngs: [number, number][] = [];
        for (let i = 0; i + 1 < freeCoords.length; i += 2) {
          const px = freeCoords[i];
          const py = freeCoords[i + 1];
          if (Number.isFinite(px) && Number.isFinite(py)) {
            latlngs.push([py, px]);
          }
        }
        if (latlngs.length >= 2) {
          L.polyline(latlngs, { color: colorHex, weight: 3.5, interactive: false }).addTo(previewLayer);
        }
      } else if (drawMode === 'rectStrip') {
        const dx = currentPt.x - startPt.x;
        const dy = currentPt.y - startPt.y;
        const len = Math.hypot(dx, dy);
        if (len > 2) {
          const cx = (startPt.x + currentPt.x) / 2;
          const cy = (startPt.y + currentPt.y) / 2;
          const angle = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
          const corners = getRotatedRectLatLngs(cx, cy, stripHalfWidth, len / 2, angle);
          L.polygon(corners, {
            color: colorHex,
            fillColor: colorHex,
            fillOpacity: 0.45,
            weight: 2,
            interactive: false,
          }).addTo(previewLayer);
        }
      } else if (drawMode === 'ellipse') {
        const cx = (startPt.x + currentPt.x) / 2;
        const cy = (startPt.y + currentPt.y) / 2;
        const rx = Math.max(5, Math.abs(currentPt.x - startPt.x) / 2);
        const ry = Math.max(5, Math.abs(currentPt.y - startPt.y) / 2);
        const pts = getRotatedEllipseLatLngs(cx, cy, rx, ry, 0);
        L.polygon(pts, {
          color: colorHex,
          fillColor: colorHex,
          fillOpacity: 0.45,
          weight: 2,
          interactive: false,
        }).addTo(previewLayer);
      }
    };

    const handleAltWidthExpand = (ev: KeyboardEvent) => {
      if (drawMode === 'rectStrip' && ev.key === 'Alt') {
        ev.preventDefault();
        stripHalfWidth = Math.min(300, stripHalfWidth + 12);
        redrawPreview();
      }
    };

    const finishDrawing = () => {
      if (!drawMode || !startPt || !currentPt) return;
      const mode = drawMode;
      const sPt = { ...startPt };
      const cPt = { ...currentPt };
      const coordsCopy = [...freeCoords];

      drawMode = null;
      startPt = null;
      currentPt = null;
      freeCoords = [];

      previewLayer.clearLayers();
      map.dragging.enable();

      const colorIdx = activeColorRef.current;
      const colorHex = getSwtColorByIdx(colorIdx).hex;

      if (mode === 'freeLine' || mode === 'straightLine') {
        if (coordsCopy.length >= 4) {
          setPlanMarkers(prev => [
            ...prev,
            {
              id: crypto.randomUUID(),
              text: '',
              x: coordsCopy[0],
              y: coordsCopy[1],
              swtTypeIndex: -4,
              swtColorIndex: colorIdx,
              color: colorHex,
              angle: 0,
              scaleX: 0,
              scaleY: 0,
              polyCoords: coordsCopy,
            },
          ]);
        }
      } else if (mode === 'rectStrip') {
        const dx = cPt.x - sPt.x;
        const dy = cPt.y - sPt.y;
        const len = Math.hypot(dx, dy);
        if (len >= 5) {
          const cx = (sPt.x + cPt.x) / 2;
          const cy = (sPt.y + cPt.y) / 2;
          const angle = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
          setPlanMarkers(prev => [
            ...prev,
            {
              id: crypto.randomUUID(),
              text: '',
              x: cx,
              y: cy,
              swtTypeIndex: -2,
              swtColorIndex: colorIdx,
              color: colorHex,
              angle,
              scaleX: stripHalfWidth,
              scaleY: len / 2,
              polyCoords: [],
            },
          ]);
        }
      } else if (mode === 'ellipse') {
        const cx = (sPt.x + cPt.x) / 2;
        const cy = (sPt.y + cPt.y) / 2;
        const rx = Math.max(8, Math.abs(cPt.x - sPt.x) / 2);
        const ry = Math.max(8, Math.abs(cPt.y - sPt.y) / 2);
        setPlanMarkers(prev => [
          ...prev,
          {
            id: crypto.randomUUID(),
            text: '',
            x: cx,
            y: cy,
            swtTypeIndex: -3,
            swtColorIndex: colorIdx,
            color: colorHex,
            angle: 0,
            scaleX: rx,
            scaleY: ry,
            polyCoords: [],
          },
        ]);
      }
    };

    window.addEventListener('keydown', handleAltWidthExpand);
    window.addEventListener('mouseup', finishDrawing);

    map.on('mousedown', (e: L.LeafletMouseEvent) => {
      const orig = e.originalEvent;
      if (orig.button !== 0 || !e.latlng) return;

      const x = Number(e.latlng.lng.toFixed(2));
      const y = Number(e.latlng.lat.toFixed(2));
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      if (orig.ctrlKey && orig.shiftKey) {
        drawMode = 'straightLine';
      } else if (orig.ctrlKey) {
        drawMode = 'freeLine';
      } else if (orig.shiftKey && orig.altKey) {
        drawMode = 'ellipse';
      } else if (orig.shiftKey) {
        drawMode = 'rectStrip';
        stripHalfWidth = 18;
      } else {
        return;
      }

      L.DomEvent.preventDefault(orig);
      map.dragging.disable();
      startPt = { x, y };
      currentPt = { x, y };
      freeCoords = [x, y];
    });

    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (!e.latlng) return;
      const x = Number(e.latlng.lng.toFixed(2));
      const y = Number(e.latlng.lat.toFixed(2));
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      setCursorPos({ x: Math.round(x), y: Math.round(y) });

      if (!drawMode || !startPt) return;
      currentPt = { x, y };

      if (drawMode === 'freeLine') {
        const lastX = freeCoords[freeCoords.length - 2];
        const lastY = freeCoords[freeCoords.length - 1];
        if (Math.hypot(x - lastX, y - lastY) >= 8) {
          freeCoords.push(x, y);
        }
      } else if (drawMode === 'straightLine') {
        freeCoords = [startPt.x, startPt.y, x, y];
      }

      redrawPreview();
    });

    map.on('mouseup', finishDrawing);

    return () => {
      window.removeEventListener('keydown', handleAltWidthExpand);
      window.removeEventListener('mouseup', finishDrawing);
      map.remove();
      leafletMapRef.current = null;
    };
  }, [activeTab, mission, mapConfig, tileAlignMode]);

  useEffect(() => {
    const layer = planLayerGroupRef.current;
    const map = leafletMapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();

    planMarkers.forEach(m => {
      if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) return;

      if (m.swtTypeIndex === -4) {
        const latlngs: [number, number][] = [];
        for (let i = 0; i + 1 < m.polyCoords.length; i += 2) {
          const px = Number(m.polyCoords[i]);
          const py = Number(m.polyCoords[i + 1]);
          if (Number.isFinite(px) && Number.isFinite(py)) {
            latlngs.push([py, px]);
          }
        }
        if (latlngs.length < 2) return;

        const poly = L.polyline(latlngs, {
          color: m.color,
          weight: 4,
          opacity: 0.95,
        }).addTo(layer);

        poly.on('mouseover', () => {
          hoveredMarkerIdRef.current = m.id;
        });
        poly.on('mouseout', () => {
          if (hoveredMarkerIdRef.current === m.id) hoveredMarkerIdRef.current = null;
        });

        poly.on('mousedown', (ev: L.LeafletMouseEvent) => {
          if (ev.originalEvent.button !== 0 || ev.originalEvent.altKey) return;
          L.DomEvent.stopPropagation(ev);
          map.dragging.disable();
          let lastLng = ev.latlng.lng;
          let lastLat = ev.latlng.lat;

          const onMove = (moveEv: L.LeafletMouseEvent) => {
            if (!moveEv.latlng) return;
            const dx = moveEv.latlng.lng - lastLng;
            const dy = moveEv.latlng.lat - lastLat;
            lastLng = moveEv.latlng.lng;
            lastLat = moveEv.latlng.lat;
            setPlanMarkers(prev =>
                prev.map(item => {
                  if (item.id !== m.id) return item;
                  const nextCoords = item.polyCoords.map((val, idx) =>
                      idx % 2 === 0 ? val + dx : val + dy
                  );
                  return {
                    ...item,
                    x: item.x + dx,
                    y: item.y + dy,
                    polyCoords: nextCoords,
                  };
                })
            );
          };

          const onUp = () => {
            map.off('mousemove', onMove);
            map.off('mouseup', onUp);
            map.dragging.enable();
          };

          map.on('mousemove', onMove);
          map.on('mouseup', onUp);
        });
        return;
      }

      if (m.swtTypeIndex === -2 || m.swtTypeIndex === -3) {
        const pts =
            m.swtTypeIndex === -2
                ? getRotatedRectLatLngs(m.x, m.y, m.scaleX || 20, m.scaleY || 20, m.angle || 0)
                : getRotatedEllipseLatLngs(m.x, m.y, m.scaleX || 20, m.scaleY || 20, m.angle || 0);

        const shape = L.polygon(pts, {
          color: m.color,
          fillColor: m.color,
          fillOpacity: 0.45,
          weight: 2,
        }).addTo(layer);

        shape.on('mouseover', () => {
          hoveredMarkerIdRef.current = m.id;
        });
        shape.on('mouseout', () => {
          if (hoveredMarkerIdRef.current === m.id) hoveredMarkerIdRef.current = null;
        });

        shape.on('mousedown', (ev: L.LeafletMouseEvent) => {
          if (ev.originalEvent.button !== 0) return;
          L.DomEvent.stopPropagation(ev);
          map.dragging.disable();
          const isRotating = ev.originalEvent.altKey;
          let lastLng = ev.latlng.lng;
          let lastLat = ev.latlng.lat;

          const onMove = (moveEv: L.LeafletMouseEvent) => {
            if (!moveEv.latlng) return;
            if (isRotating) {
              const dx = moveEv.latlng.lng - m.x;
              const dy = moveEv.latlng.lat - m.y;
              const newAngle = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
              setPlanMarkers(prev =>
                  prev.map(item => (item.id === m.id ? { ...item, angle: newAngle } : item))
              );
            } else {
              const dx = moveEv.latlng.lng - lastLng;
              const dy = moveEv.latlng.lat - lastLat;
              lastLng = moveEv.latlng.lng;
              lastLat = moveEv.latlng.lat;
              setPlanMarkers(prev =>
                  prev.map(item =>
                      item.id === m.id ? { ...item, x: item.x + dx, y: item.y + dy } : item
                  )
              );
            }
          };

          const onUp = () => {
            map.off('mousemove', onMove);
            map.off('mouseup', onUp);
            map.dragging.enable();
          };

          map.on('mousemove', onMove);
          map.on('mouseup', onUp);
        });
        return;
      }

      const icon = L.divIcon({
        className: '',
        iconSize: [0, 0],
        iconAnchor: [0, 0],
        html: renderMarkerHtml(m.swtTypeIndex, m.color, m.text, m.angle, m.scaleX || 1),
      });

      const marker = L.marker([m.y, m.x], { icon }).addTo(layer);

      marker.on('mouseover', () => {
        hoveredMarkerIdRef.current = m.id;
      });
      marker.on('mouseout', () => {
        if (hoveredMarkerIdRef.current === m.id) hoveredMarkerIdRef.current = null;
      });

      marker.on('mousedown', (ev: L.LeafletMouseEvent) => {
        if (ev.originalEvent.button !== 0) return;
        L.DomEvent.stopPropagation(ev);
        map.dragging.disable();
        const isRotating = ev.originalEvent.altKey;

        const onMove = (moveEv: L.LeafletMouseEvent) => {
          if (!moveEv.latlng) return;
          if (isRotating) {
            const dx = moveEv.latlng.lng - m.x;
            const dy = moveEv.latlng.lat - m.y;
            const newAngle = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
            setPlanMarkers(prev =>
                prev.map(item => (item.id === m.id ? { ...item, angle: newAngle } : item))
            );
          } else {
            setPlanMarkers(prev =>
                prev.map(item =>
                    item.id === m.id
                        ? { ...item, x: moveEv.latlng.lng, y: moveEv.latlng.lat }
                        : item
                )
            );
          }
        };

        const onUp = () => {
          map.off('mousemove', onMove);
          map.off('mouseup', onUp);
          map.dragging.enable();
        };

        map.on('mousemove', onMove);
        map.on('mouseup', onUp);
      });
    });
  }, [planMarkers, activeTab, mapConfig, tileAlignMode]);

  const confirmPopupMarker = () => {
    if (!popupModal) return;
    const colorDef = getSwtColorByIdx(popupModal.swtColorIdx);
    setPlanMarkers(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        text: popupModal.text,
        x: popupModal.x,
        y: popupModal.y,
        swtTypeIndex: popupModal.swtTypeIdx,
        swtColorIndex: popupModal.swtColorIdx,
        color: colorDef.hex,
        angle: popupModal.angle,
        scaleX: popupModal.scale,
        scaleY: popupModal.scale,
        polyCoords: [],
      },
    ]);
    setActiveTypeSwtIdx(popupModal.swtTypeIdx);
    setActiveColorSwtIdx(popupModal.swtColorIdx);
    setActiveMarkerScale(popupModal.scale);
    setActiveMarkerAngle(popupModal.angle);
    setPopupModal(null);
  };

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
                    ? `Остров: ${mission.worldName} (${mapConfig.worldSize}м) | Автор: ${mission.author} | ${mission.overview}`
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

        {/* Полоска параметров WMT и Разведки (Время и Погода) */}
        {mission && (
            <div className="bg-slate-900/50 border-b border-slate-800 px-6 py-2.5 flex flex-wrap items-center gap-5 text-xs text-slate-300">
              {mission.intel && (
                  <>
                    <div>
                      <span className="text-slate-500">Дата и время:</span>{' '}
                      <b className="text-emerald-400 font-mono">{mission.intel.formattedDateTime}</b>
                    </div>
                    <div>
                      <span className="text-slate-500">Погода (Старт → Прогноз):</span>{' '}
                      <span>Облака: <b>{mission.intel.startOvercastPercent}%→{mission.intel.forecastOvercastPercent}%</b></span>
                      {' | '}
                      <span>Дождь: <b className={mission.intel.startRainPercent > 40 || mission.intel.forecastRainPercent > 40 ? 'text-rose-400' : ''}>{mission.intel.startRainPercent}%→{mission.intel.forecastRainPercent}%</b></span>
                      {' | '}
                      <span>Туман: <b>{mission.intel.startFogPercent}%→{mission.intel.forecastFogPercent}%</b></span>
                      {' | '}
                      <span>Ветер: <b className={mission.intel.startWindPercent > 40 || mission.intel.forecastWindPercent > 40 ? 'text-rose-400' : ''}>{mission.intel.startWindPercent}%→{mission.intel.forecastWindPercent}%</b></span>
                    </div>
                  </>
              )}
              <div><span className="text-slate-500">Прорисовка:</span> <b>{mission.wmtSettings.viewDistance} м</b> (Земля: {mission.wmtSettings.terrainViewDistance} м)</div>
              <div><span className="text-slate-500">ТПВ:</span> <b className="text-amber-400">{mission.wmtSettings.thermalMode}</b></div>
              <div><span className="text-slate-500">Время:</span> <b>{mission.wmtSettings.missionTimeMinutes} мин</b> (Фриз: {mission.wmtSettings.freezeTimeMinutes} мин)</div>
              <div><span className="text-slate-500">Зона старта:</span> <b>{mission.wmtSettings.startZoneSize} м</b></div>
              <div><span className="text-slate-500">Потери:</span> <b>{(mission.wmtSettings.heavyLossesCoeff * 100).toFixed(1)}%</b></div>
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
                <button
                    onClick={() => {
                      setActiveTab('scripts');
                      if (!selectedScriptPath && mission.scriptFiles && mission.scriptFiles.length > 0) {
                        setSelectedScriptPath(mission.scriptFiles[0].path);
                      }
                    }}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition ${
                        activeTab === 'scripts'
                            ? 'border-emerald-500 text-emerald-400'
                            : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                >
                  <FileText className="w-4 h-4" />
                  Скрипты SQF ({mission.scriptFiles?.length || 0})
                </button>
                <button
                    onClick={() => setActiveTab('validation')}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition ${
                        activeTab === 'validation'
                            ? 'border-emerald-500 text-emerald-400'
                            : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Валидатор WOG</span>
                  {mission.validationReport && (
                      <span className="flex items-center gap-1 ml-1">
                  {mission.validationReport.filter(x => x.severity === 'Error').length > 0 && (
                      <span className="bg-rose-600 text-white text-[11px] font-bold px-1.5 py-0.5 rounded">
                      {mission.validationReport.filter(x => x.severity === 'Error').length} ош.
                    </span>
                  )}
                        {mission.validationReport.filter(x => x.severity === 'Warning').length > 0 && (
                            <span className="bg-amber-600 text-white text-[11px] font-bold px-1.5 py-0.5 rounded">
                      {mission.validationReport.filter(x => x.severity === 'Warning').length} пред.
                    </span>
                        )}
                </span>
                  )}
                </button>
              </div>

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

                      <div ref={bookingTableRef} className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-4 rounded-xl bg-slate-950">
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

                                  {isExpanded && (
                                      <div className="border-t border-slate-800 bg-slate-950/50 divide-y divide-slate-800/60">
                                        {group.units.map((u, idx) => (
                                            <div key={u.id} className="px-4 py-2 flex items-center justify-between gap-3 text-xs">
                                              <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
                                                <span className="text-slate-500 w-4">{idx + 1}.</span>
                                                <span className="font-medium text-slate-200 truncate">
                                      {u.roleDescription || u.vehicleClass}
                                    </span>
                                                {u.primaryWeapon && (
                                                    <span className="inline-flex items-center gap-1.5 bg-slate-900 border border-slate-800 text-sky-300 px-2 py-0.5 rounded font-mono text-[11px]">
                                        <ClassIcon classNameStr={u.primaryWeapon} size="h-4 w-auto max-w-[38px]" />
                                        <span>{assetNames[u.primaryWeapon] || u.primaryWeapon}</span>
                                      </span>
                                                )}
                                                {u.secondaryWeapon && (
                                                    <span className="inline-flex items-center gap-1.5 bg-amber-950/70 border border-amber-900/60 text-amber-300 px-2 py-0.5 rounded font-mono text-[11px]">
                                        <ClassIcon classNameStr={u.secondaryWeapon} size="h-4 w-auto max-w-[38px]" />
                                        <span>{assetNames[u.secondaryWeapon] || u.secondaryWeapon}</span>
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
                      <div className="lg:col-span-3 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                    <span>
                      Остров: <b className="text-slate-200">{mission.worldName}</b> ({mapConfig.worldSize} м, maxZoom: {mapConfig.maxZoom})
                      {cursorPos && (
                          <span className="ml-3 font-mono text-emerald-400">
                          [X: {cursorPos.x}, Y: {cursorPos.y}]
                        </span>
                      )}
                    </span>

                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-1">
                              <span>Привязка тайлов:</span>
                              <select
                                  value={tileAlignMode}
                                  onChange={e => setTileAlignMode(e.target.value as any)}
                                  className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-slate-200"
                              >
                                <option value="worldSize">OCAP (worldSize = {mapConfig.worldSize})</option>
                                <option value="imageSize">По полному тайлу 256px</option>
                                <option value="tms">TMS (Инверсия Y)</option>
                              </select>
                            </label>
                          </div>
                        </div>

                        <div className="relative w-full h-[680px]">
                          <div
                              ref={mapContainerRef}
                              className="relative z-0 w-full h-full rounded-xl border border-slate-800 overflow-hidden"
                          />

                          {popupModal && (
                              <div
                                  style={{ left: popupModal.screenX, top: popupModal.screenY }}
                                  onWheel={e => {
                                    if (e.shiftKey) {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      const sizes = [0.7, 1.0, 1.3];
                                      const curIdx = sizes.indexOf(popupModal.scale);
                                      const nextIdx =
                                          e.deltaY < 0
                                              ? Math.min(sizes.length - 1, curIdx + 1)
                                              : Math.max(0, curIdx - 1);
                                      setPopupModal(p => (p ? { ...p, scale: sizes[nextIdx] } : null));
                                    }
                                  }}
                                  className="absolute z-[1500] w-72 bg-slate-900/95 backdrop-blur border border-emerald-500/60 rounded-xl shadow-2xl p-3.5 space-y-2.5 text-xs"
                              >
                                <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                          <span className="font-bold text-emerald-400">
                            Новая метка [{Math.round(popupModal.x)}, {Math.round(popupModal.y)}]
                          </span>
                                  <button
                                      onClick={() => setPopupModal(null)}
                                      className="text-slate-400 hover:text-white"
                                  >
                                    ✕
                                  </button>
                                </div>

                                <div className="flex items-center justify-center py-2 bg-slate-950 rounded border border-slate-800">
                                  <div
                                      dangerouslySetInnerHTML={{
                                        __html: renderMarkerHtml(
                                            popupModal.swtTypeIdx,
                                            getSwtColorByIdx(popupModal.swtColorIdx).hex,
                                            popupModal.text || 'Превью',
                                            popupModal.angle,
                                            popupModal.scale
                                        ),
                                      }}
                                  />
                                </div>

                                <div>
                                  <label className="block text-slate-400 mb-0.5">Текст метки:</label>
                                  <input
                                      type="text"
                                      autoFocus
                                      value={popupModal.text}
                                      onChange={e => setPopupModal(p => (p ? { ...p, text: e.target.value } : null))}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') confirmPopupMarker();
                                        if (e.key === 'Escape') setPopupModal(null);
                                      }}
                                      placeholder="Текст (Enter — поставить)"
                                      className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 outline-none text-slate-100"
                                  />
                                </div>

                                <div>
                                  <label className="block text-slate-400 mb-0.5">Вид иконки (SWT 0..112):</label>
                                  <select
                                      value={popupModal.swtTypeIdx}
                                      onChange={e =>
                                          setPopupModal(p => (p ? { ...p, swtTypeIdx: Number(e.target.value) } : null))
                                      }
                                      className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 outline-none text-slate-100"
                                  >
                                    {SWT_MARKER_TYPES.map(t => (
                                        <option key={t.swtIdx} value={t.swtIdx}>
                                          {t.name}
                                        </option>
                                    ))}
                                  </select>
                                </div>

                                <div>
                                  <label className="block text-slate-400 mb-0.5">Цвет:</label>
                                  <select
                                      value={popupModal.swtColorIdx}
                                      onChange={e =>
                                          setPopupModal(p => (p ? { ...p, swtColorIdx: Number(e.target.value) } : null))
                                      }
                                      className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 outline-none text-slate-100"
                                  >
                                    {SWT_COLORS.map(c => (
                                        <option key={c.swtIdx} value={c.swtIdx}>
                                          {c.name}
                                        </option>
                                    ))}
                                  </select>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="block text-slate-400 mb-0.5">Размер (Shift+Колесо):</label>
                                    <select
                                        value={popupModal.scale}
                                        onChange={e =>
                                            setPopupModal(p => (p ? { ...p, scale: Number(e.target.value) } : null))
                                        }
                                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 outline-none"
                                    >
                                      {MARKER_SIZES.map(s => (
                                          <option key={s.value} value={s.value}>
                                            {s.label}
                                          </option>
                                      ))}
                                    </select>
                                  </div>

                                  <div>
                                    <label className="block text-slate-400 mb-0.5">
                                      Наклон: <b>{Math.round(popupModal.angle)}°</b>
                                    </label>
                                    <input
                                        type="range"
                                        min={0}
                                        max={355}
                                        step={5}
                                        value={popupModal.angle}
                                        onChange={e =>
                                            setPopupModal(p => (p ? { ...p, angle: Number(e.target.value) } : null))
                                        }
                                        className="w-full accent-emerald-500 mt-1.5"
                                    />
                                  </div>
                                </div>

                                <div className="flex gap-2 pt-1">
                                  <button
                                      onClick={confirmPopupMarker}
                                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-1.5 rounded transition"
                                  >
                                    ОК (Enter)
                                  </button>
                                  <button
                                      onClick={() => setPopupModal(null)}
                                      className="px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition"
                                  >
                                    Отмена
                                  </button>
                                </div>
                              </div>
                          )}
                        </div>
                      </div>

                      {/* Боковая панель: SWT Маркеры и Список Техники */}
                      <div className="space-y-4">
                        <div className="border border-slate-800 rounded-xl bg-slate-900/60 p-4 space-y-3">
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
                            Управление SWT Markers
                          </h3>

                          <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-[11px] text-slate-300 space-y-1">
                            <div><b className="text-emerald-400">2x ЛКМ</b> — Поставить метку (меню)</div>
                            <div><b className="text-emerald-400">Ctrl + ЛКМ</b> — Рисовать свободную линию</div>
                            <div><b className="text-emerald-400">Ctrl + Shift + ЛКМ</b> — Прямая линия</div>
                            <div><b className="text-emerald-400">Shift + ЛКМ</b> — Параллелограмм (<b>Alt</b> — шире)</div>
                            <div><b className="text-emerald-400">Shift + Alt + ЛКМ</b> — Нарисовать эллипс</div>
                            <div><b className="text-sky-400">ЛКМ (тянуть)</b> — Переместить метку/фигуру</div>
                            <div><b className="text-amber-400">Alt + ЛКМ (тянуть)</b> — Повернуть метку/фигуру</div>
                            <div><b className="text-rose-400">Delete (навести)</b> — Удалить метку под мышкой</div>
                          </div>

                          <div className="space-y-2 text-xs">
                            <label className="block text-slate-400">
                              Активный цвет (для линий, полос и эллипсов):
                            </label>
                            <select
                                value={activeColorSwtIdx}
                                onChange={e => setActiveColorSwtIdx(Number(e.target.value))}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 outline-none"
                            >
                              {SWT_COLORS.map(c => (
                                  <option key={c.swtIdx} value={c.swtIdx}>
                                    {c.name}
                                  </option>
                              ))}
                            </select>
                          </div>

                          {planMarkers.length > 0 && (
                              <div className="max-h-36 overflow-y-auto divide-y divide-slate-800 border border-slate-800 rounded bg-slate-950 p-2 text-xs">
                                {planMarkers.map(m => {
                                  let label = m.text || `Иконка #${m.swtTypeIndex}`;
                                  if (m.swtTypeIndex === -4) label = 'Линия';
                                  if (m.swtTypeIndex === -2) label = 'Параллелограмм';
                                  if (m.swtTypeIndex === -3) label = 'Эллипс';

                                  return (
                                      <div key={m.id} className="py-1 flex items-center justify-between gap-2">
                              <span style={{ color: m.color }} className="font-semibold truncate">
                                {label} [{Math.round(m.x)}, {Math.round(m.y)}]
                              </span>
                                        <button
                                            onClick={() => setPlanMarkers(prev => prev.filter(x => x.id !== m.id))}
                                            className="text-slate-500 hover:text-rose-400 shrink-0"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                  );
                                })}
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
                                placeholder='Вставьте массив SWT: [["",[7636.48,15159.1],0,12,0,1,"",[]]]'
                                value={swtArrayText}
                                onChange={e => setSwtArrayText(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded p-2 font-mono text-[11px] outline-none"
                            />
                          </div>
                        </div>

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
                                  <div className="flex items-center gap-2 min-w-0">
                                    <ClassIcon classNameStr={v.vehicleClass} size="h-6 w-8" />
                                    <div className="truncate">
                                      <div className="font-mono text-slate-200 truncate">
                                        {assetNames[v.vehicleClass] || v.vehicleClass}
                                      </div>
                                      <div className="text-[10px] text-slate-500">
                                        X={v.position[0]?.toFixed(0)}, Y={v.position[2]?.toFixed(0)}
                                      </div>
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

                {/* ВКЛАДКА 4: ПРОСМОТРЩИК SQF И КОНФИГОВ МИССИИ */}
                {activeTab === 'scripts' && mission.scriptFiles && (
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[680px]">
                      <div className="border border-slate-800 rounded-xl bg-slate-900/60 flex flex-col overflow-hidden">
                        <div className="px-4 py-3 border-b border-slate-800 font-bold text-xs uppercase tracking-wider text-slate-300">
                          Файлы в PBO ({mission.scriptFiles.length})
                        </div>
                        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60 text-xs">
                          {mission.scriptFiles.map(sf => (
                              <button
                                  key={sf.path}
                                  onClick={() => setSelectedScriptPath(sf.path)}
                                  className={`w-full px-3.5 py-2.5 text-left font-mono flex items-center justify-between gap-2 transition ${
                                      selectedScriptPath === sf.path
                                          ? 'bg-emerald-950/60 text-emerald-300 border-l-2 border-emerald-400'
                                          : 'text-slate-300 hover:bg-slate-800/60'
                                  }`}
                              >
                                <span className="truncate">{sf.path}</span>
                                <span className="text-[10px] text-slate-500 shrink-0">
                          {(sf.sizeBytes / 1024).toFixed(1)} KB
                        </span>
                              </button>
                          ))}
                        </div>
                      </div>

                      <div className="lg:col-span-3 border border-slate-800 rounded-xl bg-slate-900/60 flex flex-col overflow-hidden">
                        {(() => {
                          const currentFile =
                              mission.scriptFiles.find(x => x.path === selectedScriptPath) ||
                              mission.scriptFiles[0];
                          if (!currentFile) {
                            return <div className="p-6 text-slate-500 text-sm">В PBO нет текстовых скриптов.</div>;
                          }
                          return (
                              <>
                                <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-900 flex items-center justify-between">
                          <span className="font-mono text-xs font-bold text-emerald-400">
                            {currentFile.path}
                          </span>
                                  <button
                                      onClick={() => navigator.clipboard.writeText(currentFile.content)}
                                      className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1 rounded text-xs transition"
                                  >
                                    <Copy className="w-3.5 h-3.5" />
                                    Скопировать код
                                  </button>
                                </div>
                                <pre className="flex-1 p-4 overflow-auto bg-slate-950 text-slate-200 font-mono text-xs leading-relaxed">
                          {currentFile.content}
                        </pre>
                              </>
                          );
                        })()}
                      </div>
                    </div>
                )}

                {/* ВКЛАДКА 5: АВТОМАТИЧЕСКИЙ ВАЛИДАТОР ПРАВИЛ WOG */}
                {activeTab === 'validation' && mission.validationReport && (
                    <div className="max-w-5xl mx-auto space-y-5">
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                        <button
                            onClick={() => setValidationFilter('ALL')}
                            className={`p-3.5 rounded-xl border text-left transition ${
                                validationFilter === 'ALL'
                                    ? 'bg-slate-800 border-slate-600'
                                    : 'bg-slate-900/60 border-slate-800 hover:bg-slate-900'
                            }`}
                        >
                          <div className="text-xl font-bold text-slate-100">{mission.validationReport.length}</div>
                          <div className="text-xs text-slate-400">Всего проверок</div>
                        </button>

                        <button
                            onClick={() => setValidationFilter('Error')}
                            className={`p-3.5 rounded-xl border text-left transition ${
                                validationFilter === 'Error'
                                    ? 'bg-rose-950/60 border-rose-500'
                                    : 'bg-slate-900/60 border-slate-800 hover:bg-slate-900'
                            }`}
                        >
                          <div className="text-xl font-bold text-rose-400">
                            {mission.validationReport.filter(x => x.severity === 'Error').length}
                          </div>
                          <div className="text-xs text-rose-300/80">Ошибок (Error)</div>
                        </button>

                        <button
                            onClick={() => setValidationFilter('Warning')}
                            className={`p-3.5 rounded-xl border text-left transition ${
                                validationFilter === 'Warning'
                                    ? 'bg-amber-950/60 border-amber-500'
                                    : 'bg-slate-900/60 border-slate-800 hover:bg-slate-900'
                            }`}
                        >
                          <div className="text-xl font-bold text-amber-400">
                            {mission.validationReport.filter(x => x.severity === 'Warning').length}
                          </div>
                          <div className="text-xs text-amber-300/80">Предупреждений (Warning)</div>
                        </button>

                        <button
                            onClick={() => setValidationFilter('Ok')}
                            className={`p-3.5 rounded-xl border text-left transition ${
                                validationFilter === 'Ok'
                                    ? 'bg-emerald-950/60 border-emerald-500'
                                    : 'bg-slate-900/60 border-slate-800 hover:bg-slate-900'
                            }`}
                        >
                          <div className="text-xl font-bold text-emerald-400">
                            {mission.validationReport.filter(x => x.severity === 'Ok').length}
                          </div>
                          <div className="text-xs text-emerald-300/80">Пройдено успешно (OK)</div>
                        </button>
                      </div>

                      <div className="space-y-4">
                        {Array.from(new Set(mission.validationReport.map(i => i.category))).map(category => {
                          const items = mission.validationReport!.filter(
                              i => i.category === category && (validationFilter === 'ALL' || i.severity === validationFilter)
                          );
                          if (items.length === 0) return null;

                          return (
                              <div key={category} className="border border-slate-800 rounded-xl bg-slate-900/60 overflow-hidden">
                                <div className="bg-slate-900 px-4 py-2.5 border-b border-slate-800 font-bold text-xs uppercase tracking-wider text-slate-300">
                                  {category}
                                </div>
                                <div className="divide-y divide-slate-800/70">
                                  {items.map((item, idx) => (
                                      <div key={idx} className="p-3.5 flex items-start gap-3 text-xs">
                                        {item.severity === 'Error' && (
                                            <XCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                                        )}
                                        {item.severity === 'Warning' && (
                                            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                                        )}
                                        {item.severity === 'Ok' && (
                                            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                                        )}

                                        <div className="space-y-1 flex-1">
                                          <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                                    {item.ruleNumber}
                                  </span>
                                            <span
                                                className={`font-bold text-sm ${
                                                    item.severity === 'Error'
                                                        ? 'text-rose-400'
                                                        : item.severity === 'Warning'
                                                            ? 'text-amber-300'
                                                            : 'text-emerald-300'
                                                }`}
                                            >
                                    {item.title}
                                  </span>
                                          </div>
                                          <p className="text-slate-400 leading-relaxed">{item.details}</p>
                                        </div>
                                      </div>
                                  ))}
                                </div>
                              </div>
                          );
                        })}
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
                className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[2000]"
            >
              <div
                  onClick={e => e.stopPropagation()}
                  className="bg-slate-900 border border-slate-700 rounded-xl max-w-xl w-full p-5 space-y-4 text-xs"
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-950 p-3 rounded border border-slate-800">
                  {[
                    { label: 'Основное', val: inspectedUnit.primaryWeapon, color: 'text-sky-300' },
                    { label: 'Труба/ПТ', val: inspectedUnit.secondaryWeapon, color: 'text-amber-300' },
                    { label: 'Пистолет', val: inspectedUnit.handgun, color: 'text-slate-200' },
                    { label: 'Форма', val: inspectedUnit.loadout.uniform, color: 'text-slate-200' },
                    { label: 'Разгрузка', val: inspectedUnit.loadout.vest, color: 'text-slate-200' },
                    { label: 'Рюкзак', val: inspectedUnit.loadout.backpack, color: 'text-slate-200' },
                    { label: 'Шлем', val: inspectedUnit.loadout.headgear, color: 'text-slate-200' },
                  ].map(slot => (
                      <div key={slot.label} className="flex items-center gap-2 bg-slate-900/70 p-1.5 rounded border border-slate-800/80">
                        <ClassIcon classNameStr={slot.val} size="h-7 w-10" />
                        <div className="min-w-0">
                          <div className="text-[10px] text-slate-500">{slot.label}:</div>
                          <div className={`font-mono font-semibold truncate ${slot.color}`} title={slot.val}>
                            {formatClassTitle(slot.val)}
                          </div>
                        </div>
                      </div>
                  ))}
                </div>

                {inspectedUnit.loadout.weaponAttachments.length > 0 && (
                    <div>
                      <div className="font-semibold text-slate-400 mb-1">Обвесы и прицелы:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {inspectedUnit.loadout.weaponAttachments.map(a => (
                            <span key={a} className="inline-flex items-center gap-1.5 bg-slate-800 px-2 py-1 rounded font-mono">
                      <ClassIcon classNameStr={a} size="h-5 w-7" />
                      <span>{formatClassTitle(a)}</span>
                    </span>
                        ))}
                      </div>
                    </div>
                )}

                <div>
                  <div className="font-semibold text-slate-400 mb-1">Боекомплект и снаряжение в инвентаре:</div>
                  <div className="max-h-56 overflow-y-auto divide-y divide-slate-800 bg-slate-950 rounded border border-slate-800 px-3 py-1">
                    {Object.entries(inspectedUnit.loadout.itemsAndMagazines).map(([item, count]) => (
                        <div key={item} className="py-1.5 flex items-center justify-between gap-2 font-mono">
                          <div className="flex items-center gap-2 min-w-0">
                            <ClassIcon classNameStr={item} size="h-6 w-8" />
                            <span className="truncate">{formatClassTitle(item)}</span>
                          </div>
                          <span className="text-emerald-400 font-bold shrink-0">x{count}</span>
                        </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
        )}

        {/* МОДАЛКА: ИНВЕНТАРЬ ТЕХНИКИ / ЯЩИКА (С ИКОНКАМИ, СТАТУСОМ И ACE CARGO ВНУТРИ ПРОВЕРКИ inspectedVehicle!) */}
        {inspectedVehicle && (
            <div
                onClick={() => setInspectedVehicle(null)}
                className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[2000]"
            >
              <div
                  onClick={e => e.stopPropagation()}
                  className="bg-slate-900 border border-slate-700 rounded-xl max-w-xl w-full p-5 space-y-4 text-xs"
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-3">
                    <ClassIcon classNameStr={inspectedVehicle.vehicleClass} size="h-10 w-14" />
                    <div>
                      <h3 className="text-base font-bold text-amber-400">
                        {formatClassTitle(inspectedVehicle.vehicleClass)}
                      </h3>
                      <p className="text-slate-400">
                        Координаты: X={inspectedVehicle.position[0]?.toFixed(0)}, Y={inspectedVehicle.position[2]?.toFixed(0)}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => setInspectedVehicle(null)} className="text-slate-400 hover:text-white text-sm">
                    ✕
                  </button>
                </div>

                {/* Статус блокировки, Топливо, БК и Прочность */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-950 p-2.5 rounded border border-slate-800 text-center">
                  <div>
                    <div className="text-[10px] text-slate-500">Статус:</div>
                    <div className={`font-bold ${inspectedVehicle.lockStatus === 'LOCKED' || inspectedVehicle.lockStatus === 'LOCKEDPLAYER' ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {inspectedVehicle.lockStatus || 'UNLOCKED'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500">Топливо:</div>
                    <div className="font-bold text-slate-200">{Math.round((inspectedVehicle.fuel ?? 1) * 100)}%</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500">Боекомплект турели:</div>
                    <div className="font-bold text-slate-200">{Math.round((inspectedVehicle.ammo ?? 1) * 100)}%</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500">Прочность:</div>
                    <div className="font-bold text-slate-200">{Math.round((inspectedVehicle.health ?? 1) * 100)}%</div>
                  </div>
                </div>

                {/* ACE Cargo (Колеса, гусеницы, канистры и т.д.) */}
                {inspectedVehicle.aceCargoItems && Object.keys(inspectedVehicle.aceCargoItems).length > 0 && (
                    <div>
                      <div className="font-semibold text-emerald-400 mb-1">
                        ACE Cargo (Колеса / Гусеницы / Канистры)
                        {inspectedVehicle.aceCargoSpace !== undefined && inspectedVehicle.aceCargoSpace >= 0 && (
                            <span className="text-slate-400 font-normal ml-2">(Вместимость: {inspectedVehicle.aceCargoSpace})</span>
                        )}:
                      </div>
                      <div className="divide-y divide-slate-800 bg-slate-950 rounded border border-slate-800 px-3 py-1 font-mono">
                        {Object.entries(inspectedVehicle.aceCargoItems).map(([k, v]) => (
                            <div key={k} className="py-1.5 flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <ClassIcon classNameStr={k} size="h-5 w-7" />
                                <span className="truncate">{formatClassTitle(k)}</span>
                              </div>
                              <span className="text-emerald-400 font-bold shrink-0">x{v}</span>
                            </div>
                        ))}
                      </div>
                    </div>
                )}

                {/* Атрибуты 3DEN (Инженерная/Мед техника, скрипты и др.) */}
                {inspectedVehicle.customAttributes && Object.keys(inspectedVehicle.customAttributes).filter(k => !k.toLowerCase().includes('ammobox')).length > 0 && (
                    <div>
                      <div className="font-semibold text-slate-400 mb-1">Атрибуты объекта в 3DEN:</div>
                      <div className="max-h-28 overflow-y-auto divide-y divide-slate-800 bg-slate-950 rounded border border-slate-800 px-3 py-1 font-mono text-[11px]">
                        {Object.entries(inspectedVehicle.customAttributes)
                            .filter(([k]) => !k.toLowerCase().includes('ammobox'))
                            .map(([k, v]) => (
                                <div key={k} className="py-1 flex justify-between gap-3">
                                  <span className="text-slate-400 truncate">{k}</span>
                                  <span className="text-sky-300 truncate">{v}</span>
                                </div>
                            ))}
                      </div>
                    </div>
                )}

                {!inspectedVehicle.cargo.hasAnyCargo ? (
                    <p className="text-slate-400 py-4 text-center">Кузов пуст (дополнительный лут через SQF не выдан)</p>
                ) : (
                    <div className="max-h-64 overflow-y-auto space-y-3">
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
                                      <div key={k} className="py-1.5 flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                          <ClassIcon classNameStr={k} size="h-6 w-8" />
                                          <span className="truncate">{formatClassTitle(k)}</span>
                                        </div>
                                        <span className="text-amber-400 font-bold shrink-0">x{v}</span>
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