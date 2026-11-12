export const participantIds = ["father", "mother", "daughter"] as const;
export type ParticipantId = (typeof participantIds)[number];
export const participants = [
  { id: "father", name: "Папа", avatar: "🧔", color: "#5480b7" },
  { id: "mother", name: "Мама", avatar: "👩", color: "#c56d8b" },
  { id: "daughter", name: "Дочь", avatar: "👧", color: "#bd8d27" },
] as const;
const entries = [
  [
    "pizza",
    "Пиццерия",
    "🍕",
    "Готовим или заказываем пиццу, выбираем начинки и устраиваем семейный ужин.",
  ],
  [
    "cinema",
    "Кинотеатр",
    "🎬",
    "Выбираем мультфильм или фильм, готовим попкорн и устраиваем домашний кинотеатр.",
  ],
  [
    "board-games",
    "Игровой клуб",
    "🎲",
    "Играем в настольные, карточные и другие семейные игры.",
  ],
  [
    "ocean",
    "Океанариум",
    "🐙",
    "Знакомимся с морскими животными, смотрим познавательные видео, рисуем и играем.",
  ],
  [
    "science",
    "Лаборатория",
    "🧪",
    "Проводим безопасные домашние научные эксперименты вместе со взрослыми.",
  ],
  [
    "workshop",
    "Мастерская",
    "🎨",
    "Рисуем, лепим, строим или создаём совместную поделку.",
  ],
  [
    "fort",
    "Секретный штаб",
    "⛺",
    "Строим шалаш из подушек и одеял, устраиваем внутри семейный вечер.",
  ],
  [
    "disco",
    "Дискотека",
    "🪩",
    "Выбираем музыку, танцуем, устраиваем музыкальные игры.",
  ],
  [
    "picnic",
    "Пикник",
    "🧺",
    "Организуем необычный семейный ужин дома или на природе.",
  ],
  [
    "treasure",
    "Поиск сокровищ",
    "🗺️",
    "Ищем спрятанный клад по карте и подсказкам.",
  ],
  [
    "theatre",
    "Театр",
    "🎭",
    "Придумываем сказки, устраиваем спектакли или театр теней.",
  ],
  [
    "expedition",
    "Экспедиция",
    "🌳",
    "Отправляемся на прогулку в интересное место и ищем новые открытия.",
  ],
];
export const activities = entries.map(([id, title, emoji, description]) => ({
  id,
  title,
  emoji,
  description,
  shortDescription: description,
  image: `/images/${id}.svg`,
}));
export const settings = {
  timezone: process.env.TZ || "Europe/Moscow",
  cardCount: 8,
  starThreshold: 3,
};
