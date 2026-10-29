import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Описание структуры твоего map.json
export interface OcapMapConfig {
    name: string;
    worldname: string;
    worldSize: number;
    imageSize: number;
    multiplier: number;
    maxZoom: number;
    hasTopo?: boolean;
}

// Пример интерфейса юнита/техники/маркера из твоего парсера
export interface MapEntity {
    id: string;
    name: string;
    side?: 'WEST' | 'EAST' | 'GUER' | 'CIV' | string;
    x: number; // Координата X из mission.sqm (Position[0])
    y: number; // Координата Y из mission.sqm (Position[2] - т.к. в Arma 3 формат [X, Z(высота), Y])
    details?: string; // Например, название отделения или список инвентаря
}

interface MissionMapProps {
    worldName: string; // Например, "altis" (из названия pbo или парсера)
    apiBaseUrl?: string; // URL твоего ASP.NET API, например "http://localhost:5000"
    entities: MapEntity[];
}

// Цвета сторон для иконок юнитов
const getSideColor = (side?: string): string => {
    switch (side?.toUpperCase()) {
        case 'WEST':
        case 'BLUFOR':
            return '#004d99'; // Синие
        case 'EAST':
        case 'OPFOR':
            return '#800000'; // Красные
        case 'GUER':
        case 'INDEPENDENT':
            return '#008000'; // Зеленые
        default:
            return '#d97706'; // Желтый/оранжевый для пустой техники или маркеров
    }
};

export const MissionMap: React.FC<MissionMapProps> = ({
                                                          worldName,
                                                          apiBaseUrl = 'http://localhost:5123',
                                                          entities,
                                                      }) => {
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const mapInstanceRef = useRef<L.Map | null>(null);
    const markersLayerRef = useRef<L.LayerGroup | null>(null);

    const [mapConfig, setMapConfig] = useState<OcapMapConfig | null>(null);
    const [cursorCoords, setCursorCoords] = useState<{ x: number; y: number } | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Перевод координат Arma 3 (метры: 0..30720 снизу вверх) -> Leaflet LatLng (0..-240 сверху вниз)
    const armaToLatLng = (x: number, y: number, config: OcapMapConfig): L.LatLng => {
        const scale = Math.pow(2, config.maxZoom) / config.multiplier; // Для Altis = 128
        const lng = x / scale;
        // В Arma Y=0 на юге (внизу), а в тайлах Y=0 на севере (вверху), поэтому вычитаем из worldSize:
        const lat = -(config.worldSize - y) / scale;
        return L.latLng(lat, lng);
    };

    // Обратный перевод: Leaflet LatLng -> Координаты Arma 3 (для плашки координат под курсором)
    const latLngToArma = (latlng: L.LatLng, config: OcapMapConfig) => {
        const scale = Math.pow(2, config.maxZoom) / config.multiplier;
        const x = Math.round(latlng.lng * scale);
        const y = Math.round(config.worldSize + latlng.lat * scale);
        return { x, y };
    };

    // 1. Загружаем map.json при смене острова
    useEffect(() => {
        if (!worldName) return;
        const cleanWorldName = worldName.toLowerCase();

        fetch(`${apiBaseUrl}/api/maps/${cleanWorldName}/map.json`)
            .then((res) => {
                if (!res.ok) throw new Error(`Карта "${cleanWorldName}" не найдена на сервере`);
                return res.json();
            })
            .then((config: OcapMapConfig) => {
                setError(null);
                setMapConfig(config);
            })
            .catch((err) => {
                setError(err.message);
                setMapConfig(null);
            });
    }, [worldName, apiBaseUrl]);

    // 2. Инициализируем карту Leaflet после загрузки map.json
    useEffect(() => {
        if (!mapConfig || !mapContainerRef.current) return;

        // Удаляем старый инстанс карты при переключении миссии
        if (mapInstanceRef.current) { 
            mapInstanceRef.current.remove();
            mapInstanceRef.current = null;
        }

        const southWest = armaToLatLng(0, 0, mapConfig);
        const northEast = armaToLatLng(mapConfig.worldSize, mapConfig.worldSize, mapConfig);
        const mapBounds = L.latLngBounds(southWest, northEast);

        const map = L.map(mapContainerRef.current, {
            crs: L.CRS.Simple,
            minZoom: 0,
            maxZoom: mapConfig.maxZoom,
            maxBounds: mapBounds.pad(0.2),
            attributionControl: false,
        });

        // Подключаем тайлы из папки (если у тебя топографические тайлы лежат сразу в 0..7)
        L.tileLayer(`${apiBaseUrl}/api/maps/${mapConfig.worldname.toLowerCase()}/{z}/{x}/{y}.png`, {
            minZoom: 0,
            maxZoom: mapConfig.maxZoom,
            noWrap: true,
            bounds: mapBounds,
            tileSize: 256,
        }).addTo(map);

        // Центрируем камеру по центру острова (на зуме 2)
        const center = armaToLatLng(mapConfig.worldSize / 2, mapConfig.worldSize / 2, mapConfig);
        map.setView(center, 2);

        // Слой для маркеров юнитов и техники
        const markersLayer = L.layerGroup().addTo(map);
        markersLayerRef.current = markersLayer;

        // Отслеживание игровых координат под мышкой
        map.on('mousemove', (e: L.LeafletMouseEvent) => {
            setCursorCoords(latLngToArma(e.latlng, mapConfig));
        });

        mapInstanceRef.current = map;

        return () => {
            map.remove();
            mapInstanceRef.current = null;
        };
    }, [mapConfig, apiBaseUrl]);

    // 3. Отрисовка юнитов и техники при обновлении массива entities
    useEffect(() => {
        if (!mapConfig || !markersLayerRef.current) return;

        const layer = markersLayerRef.current;
        layer.clearLayers();

        entities.forEach((entity) => {
            const pos = armaToLatLng(entity.x, entity.y, mapConfig);
            const color = getSideColor(entity.side);

            const marker = L.circleMarker(pos, {
                radius: 6,
                fillColor: color,
                color: '#ffffff',
                weight: 1.5,
                opacity: 1,
                fillOpacity: 0.9,
            });

            marker.bindPopup(`
        <div style="font-family: sans-serif; min-width: 150px;">
          <strong>${entity.name}</strong><br/>
          <span style="color: #666; font-size: 12px;">Координаты: [${Math.round(entity.x)}, ${Math.round(entity.y)}]</span>
          ${entity.details ? `<hr style="margin: 4px 0;"/><div style="font-size: 12px;">${entity.details}</div>` : ''}
        </div>
      `);

            marker.addTo(layer);
        });
    }, [entities, mapConfig]);

    if (error) {
        return (
            <div style={{ padding: '20px', background: '#2d1a1a', color: '#ff8080', borderRadius: '8px' }}>
                Ошибка загрузки карты: {error}
            </div>
        );
    }

    return (
        <div style={{ position: 'relative', width: '100%', height: '650px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #333' }}>
            {/* Плашка с координатами и названием острова */}
            <div
                style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    zIndex: 1000,
                    background: 'rgba(20, 20, 20, 0.85)',
                    color: '#fff',
                    padding: '6px 12px',
                    borderRadius: '4px',
                    fontSize: '13px',
                    fontFamily: 'monospace',
                    pointerEvents: 'none',
                }}
            >
                <div>Остров: {mapConfig?.name || worldName}</div>
                {cursorCoords && (
                    <div>
                        X: {cursorCoords.x} | Y: {cursorCoords.y} (Grid: {String(Math.floor(cursorCoords.x / 100)).padStart(3, '0')} - {String(Math.floor(cursorCoords.y / 100)).padStart(3, '0')})
                    </div>
                )}
            </div>

            {/* Контейнер самой карты */}
            <div ref={mapContainerRef} style={{ width: '100%', height: '100%', background: '#1a2634' }} />
        </div>
    );
};