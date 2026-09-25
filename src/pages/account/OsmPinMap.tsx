import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Minus, Plus } from "lucide-react";

type Coordinates = { latitude: number; longitude: number };

type Props = {
  latitude: number | null;
  longitude: number | null;
  onChange: (coordinates: Coordinates) => void;
};

const TILE_SIZE = 256;
const DEFAULT_CENTER: Coordinates = { latitude: -10, longitude: -55 };
const DEFAULT_ZOOM = 4;
const DETAIL_ZOOM = 16;

function clampLatitude(value: number) {
  return Math.max(-85.05112878, Math.min(85.05112878, value));
}

function clampLongitude(value: number) {
  let longitude = value;
  while (longitude < -180) longitude += 360;
  while (longitude > 180) longitude -= 360;
  return longitude;
}

function project(latitude: number, longitude: number, zoom: number) {
  const lat = (clampLatitude(latitude) * Math.PI) / 180;
  const scale = Math.pow(2, zoom) * TILE_SIZE;
  return {
    x: ((clampLongitude(longitude) + 180) / 360) * scale,
    y:
      (0.5 -
        Math.log((1 + Math.sin(lat)) / (1 - Math.sin(lat))) /
          (4 * Math.PI)) *
      scale,
  };
}

function unproject(x: number, y: number, zoom: number): Coordinates {
  const scale = Math.pow(2, zoom) * TILE_SIZE;
  const longitude = (x / scale) * 360 - 180;
  const normalized = 1 - (2 * y) / scale;
  const latitude =
    (Math.atan(Math.sinh(Math.PI * normalized)) * 180) / Math.PI;
  return {
    latitude: Math.max(-90, Math.min(90, latitude)),
    longitude: clampLongitude(longitude),
  };
}

function tileUrl(x: number, y: number, zoom: number) {
  const n = Math.pow(2, zoom);
  const wrappedX = ((x % n) + n) % n;
  if (y < 0 || y >= n) return null;
  return `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`;
}

export function OsmPinMap({
  latitude,
  longitude,
  onChange,
}: Props) {
  const hasPin =
    latitude !== null &&
    longitude !== null &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude);

  const [center, setCenter] = useState<Coordinates>(
    hasPin ? { latitude, longitude } : DEFAULT_CENTER,
  );
  const [zoom, setZoom] = useState(hasPin ? DETAIL_ZOOM : DEFAULT_ZOOM);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    centerWorldX: number;
    centerWorldY: number;
  } | null>(null);

  useEffect(() => {
    if (!hasPin) return;
    setCenter({ latitude, longitude });
  }, [hasPin, latitude, longitude]);

  const centerWorld = useMemo(
    () => project(center.latitude, center.longitude, zoom),
    [center, zoom],
  );

  const tiles = useMemo(() => {
    const centerTileX = Math.floor(centerWorld.x / TILE_SIZE);
    const centerTileY = Math.floor(centerWorld.y / TILE_SIZE);
    const result: Array<{
      key: string;
      src: string;
      left: number;
      top: number;
    }> = [];

    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const x = centerTileX + dx;
        const y = centerTileY + dy;
        const src = tileUrl(x, y, zoom);
        if (!src) continue;
        result.push({
          key: `${zoom}-${x}-${y}`,
          src,
          left: x * TILE_SIZE - centerWorld.x,
          top: y * TILE_SIZE - centerWorld.y,
        });
      }
    }
    return result;
  }, [centerWorld, zoom]);

  const pinOffset = useMemo(() => {
    if (!hasPin) return null;
    const pinWorld = project(latitude, longitude, zoom);
    return {
      x: pinWorld.x - centerWorld.x,
      y: pinWorld.y - centerWorld.y,
    };
  }, [centerWorld, hasPin, latitude, longitude, zoom]);

  function coordinateAtClient(clientX: number, clientY: number) {
    const element = mapRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return unproject(
      centerWorld.x + clientX - rect.left - rect.width / 2,
      centerWorld.y + clientY - rect.top - rect.height / 2,
      zoom,
    );
  }

  function placePin(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("[data-map-control]")) return;
    if ((event.target as HTMLElement).closest("[data-map-pin]")) return;
    const coordinates = coordinateAtClient(event.clientX, event.clientY);
    if (!coordinates) return;
    onChange(coordinates);
    if (!hasPin) {
      setCenter(coordinates);
      setZoom(DETAIL_ZOOM);
    }
  }

  function startPan(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("[data-map-control]")) return;
    if ((event.target as HTMLElement).closest("[data-map-pin]")) return;
    panRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      centerWorldX: centerWorld.x,
      centerWorldY: centerWorld.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePan(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const dx = event.clientX - pan.x;
    const dy = event.clientY - pan.y;
    setCenter(
      unproject(
        pan.centerWorldX - dx,
        pan.centerWorldY - dy,
        zoom,
      ),
    );
  }

  function stopPan(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const moved =
      Math.abs(event.clientX - pan.x) > 4 ||
      Math.abs(event.clientY - pan.y) > 4;
    panRef.current = null;
    if (!moved) placePin(event);
  }

  function dragPin(event: ReactPointerEvent<HTMLButtonElement>) {
    const coordinates = coordinateAtClient(event.clientX, event.clientY);
    if (coordinates) onChange(coordinates);
  }

  function zoomBy(delta: number) {
    setZoom((current) =>
      Math.max(3, Math.min(18, current + delta)),
    );
  }

  return (
    <div className="osm-pin-map-shell">
      <div
        ref={mapRef}
        className="osm-pin-map"
        aria-label="Mapa para ajustar o ponto de entrega"
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={stopPan}
        onPointerCancel={() => {
          panRef.current = null;
        }}
      >
        <div className="osm-tile-layer" aria-hidden="true">
          {tiles.map((tile) => (
            <img
              key={tile.key}
              src={tile.src}
              alt=""
              draggable={false}
              style={{
                left: `calc(50% + ${tile.left}px)`,
                top: `calc(50% + ${tile.top}px)`,
              }}
            />
          ))}
        </div>

        {pinOffset && (
          <button
            type="button"
            className="osm-pin"
            data-map-pin
            aria-label="Ponto de entrega. Arraste para ajustar."
            style={{
              left: `calc(50% + ${pinOffset.x}px)`,
              top: `calc(50% + ${pinOffset.y}px)`,
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                dragPin(event);
            }}
          >
            <span aria-hidden="true" />
          </button>
        )}

        <div className="osm-map-controls" data-map-control>
          <button
            type="button"
            aria-label="Aproximar mapa"
            onClick={() => zoomBy(1)}
          >
            <Plus />
          </button>
          <button
            type="button"
            aria-label="Afastar mapa"
            onClick={() => zoomBy(-1)}
          >
            <Minus />
          </button>
        </div>

        <a
          className="osm-attribution"
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          data-map-control
        >
          © OpenStreetMap
        </a>
      </div>

      <p className="osm-map-help">
        {hasPin
          ? "Arraste o marcador ou toque em outro ponto para ajustar."
          : "Toque no mapa para posicionar o ponto de entrega."}
      </p>
    </div>
  );
}
