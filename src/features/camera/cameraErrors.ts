export type CameraErrorKind =
  | 'denied'
  | 'not-found'
  | 'in-use'
  | 'insecure'
  | 'unsupported'
  | 'ended'
  | 'model'
  | 'unknown';

export class CameraError extends Error {
  readonly kind: CameraErrorKind;

  constructor(kind: CameraErrorKind, message?: string) {
    super(message ?? kind);
    this.name = 'CameraError';
    this.kind = kind;
  }
}

/** Maps getUserMedia DOMException names (incl. legacy aliases) to a user-facing kind. */
export function classifyCameraError(error: unknown): CameraErrorKind {
  if (error instanceof CameraError) return error.kind;
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'not-found';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'in-use';
    case 'SecurityError':
      return 'insecure';
    default:
      return 'unknown';
  }
}

export interface CameraErrorCopy {
  title: string;
  message: string;
  fixes: string[];
}

export const CAMERA_ERROR_COPY: Record<CameraErrorKind, CameraErrorCopy> = {
  denied: {
    title: 'Нет доступа к камере',
    message: 'Браузер запретил доступ к камере. Без неё игра не увидит твои движения.',
    fixes: [
      'Нажми на значок камеры или замка слева от адреса сайта',
      'Выбери «Разрешить» для камеры',
      'Нажми «Попробовать снова»',
    ],
  },
  'not-found': {
    title: 'Камера не найдена',
    message: 'Мы не нашли подключённую камеру на этом устройстве.',
    fixes: [
      'Подключи веб-камеру или открой сайт на ноутбуке/телефоне с камерой',
      'Проверь, что камера не выключена переключателем или шторкой',
      'Нажми «Попробовать снова»',
    ],
  },
  'in-use': {
    title: 'Камера занята',
    message: 'Похоже, камеру сейчас использует другое приложение или вкладка.',
    fixes: ['Закрой Zoom, Teams, OBS и другие вкладки с камерой', 'Нажми «Попробовать снова»'],
  },
  insecure: {
    title: 'Нужно защищённое соединение',
    message: 'Браузеры дают доступ к камере только по HTTPS или на localhost.',
    fixes: ['Открой сайт по адресу, начинающемуся с https://', 'Локально используй http://localhost'],
  },
  unsupported: {
    title: 'Браузер не поддерживает камеру',
    message: 'В этом браузере нет доступа к камере из веб-страниц.',
    fixes: ['Открой сайт в свежем Chrome, Edge, Safari или Firefox'],
  },
  ended: {
    title: 'Камера отключилась',
    message: 'Видеопоток прервался — камеру отключили или её забрало другое приложение.',
    fixes: ['Проверь подключение камеры', 'Нажми «Попробовать снова»'],
  },
  model: {
    title: 'Не удалось загрузить модель',
    message: 'Модель распознавания позы не загрузилась. Обычно помогает перезагрузка.',
    fixes: ['Проверь интернет-соединение', 'Нажми «Попробовать снова» или обнови страницу'],
  },
  unknown: {
    title: 'Камера недоступна',
    message: 'Мы не смогли получить изображение с камеры.',
    fixes: ['Проверь разрешения браузера для камеры', 'Закрой другие приложения с камерой', 'Обнови страницу'],
  },
};
