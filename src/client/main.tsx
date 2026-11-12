import React, { useEffect, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import type { ParticipantId } from "../domain/catalog";
import type { State, Voting } from "../domain/engine";
import "./style.css";
type Activity = {
  id: string;
  title: string;
  emoji: string;
  description: string;
  shortDescription: string;
  image: string;
};
type PublicVoting = Voting & { participation: ParticipantId[] };
type Data = {
  state: Omit<State, "votings"> & { votings: PublicVoting[] };
  participants: {
    id: ParticipantId;
    name: string;
    avatar: string;
    color: string;
  }[];
  activities: Activity[];
  today: string;
};
class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  if (!response.ok)
    throw new ApiError(value.error || "Ошибка запроса", response.status);
  return value;
}
const formatDate = (d: string) =>
  new Intl.DateTimeFormat("ru", { day: "numeric", month: "long" }).format(
    new Date(`${d}T12:00:00`),
  );
function App() {
  const [me, setMe] = useState<ParticipantId>();
  const [data, setData] = useState<Data>();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState("home");
  const [selected, setSelected] = useState<Activity>();
  const [detail, setDetail] = useState<PublicVoting>();
  const [confirm, setConfirm] = useState<"skip" | "complete">();
  const refresh = useCallback(async () => {
    try {
      const d = await api<Data>("/state");
      setData(d);
      setError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setMe(undefined);
        setData(undefined);
      } else setError("Не удалось связаться с сервером. Проверьте соединение.");
    }
  }, []);
  useEffect(() => {
    api<{ participantId: ParticipantId }>("/auth/me")
      .then((r) => setMe(r.participantId))
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401))
          setError("Не удалось связаться с сервером");
      })
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!me) return;
    void refresh();
    const interval = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 4000);
    const focus = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", focus);
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", focus);
      window.removeEventListener("focus", focus);
    };
  }, [me, refresh]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelected(undefined);
        setDetail(undefined);
        setConfirm(undefined);
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка соединения");
    } finally {
      setBusy(false);
    }
  }
  const alert = error && (
    <div role="alert" className="error">
      {error} <button onClick={() => void refresh()}>Повторить</button>
    </div>
  );
  if (!ready)
    return (
      <main className="login">
        <p>Собираем семейный парламент…</p>
      </main>
    );
  if (!me)
    return (
      <main className="login">
        <div className="login-art">
          🏡
          <span>
            Маленькие традиции.
            <br />
            Большие воспоминания.
          </span>
        </div>
        <form
          className="login-box"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const r = await api<{ participantId: ParticipantId }>(
                "/auth/login",
                "POST",
                { password },
              );
              setMe(r.participantId);
              setPassword("");
            });
          }}
        >
          <div className="eyebrow">НАША СЕМЕЙНАЯ ТРАДИЦИЯ</div>
          <h1>
            Семейный
            <br />
            парламент<span className="dot">.</span>
          </h1>
          <p>Три голоса. Одна прекрасная суббота.</p>
          <label htmlFor="password">Твой семейный пароль</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="primary" disabled={busy}>
            Войти в парламент →
          </button>
          {alert}
          <small>Здесь важен голос каждого ♥</small>
        </form>
      </main>
    );
  if (!data)
    return <main className="loading">Загружаем семейные планы…{alert}</main>;
  const participant = data.participants.find((p) => p.id === me)!;
  const v = data.state.votings.find((v) => v.id === data.state.currentVotingId);
  const activity = (id?: string) => data.activities.find((a) => a.id === id);
  const winner = activity(v?.winnerActivityId);
  const stars = (id: string) => (
    <div className="stars">
      {data.participants.map((p) => {
        const n = data.state.stars[p.id][id]?.count || 0;
        return (
          <span
            key={p.id}
            title={`${p.name}: ${n} из 3 звёзд`}
            aria-label={`${p.name}: ${n} из 3 звёзд`}
          >
            <span>{p.avatar}</span>
            <b style={{ color: p.color }}>
              {"★".repeat(n)}
              <i>{"☆".repeat(3 - n)}</i>
            </b>
          </span>
        );
      })}
    </div>
  );
  const results = (item: PublicVoting) => (
    <div className="results">
      {item.resolutionType === "guaranteed" ? (
        <p>
          Исполняем желание:{" "}
          {item.guaranteedParticipantIds
            .map((id) => data.participants.find((p) => p.id === id)?.name)
            .join(", ")}
          . Три звезды превратились в семейный план!
        </p>
      ) : (
        data.participants.map((p) => (
          <div key={p.id}>
            <span>
              {p.avatar} {p.name}
            </span>
            <strong>
              {item.votes[p.id]
                ? `${activity(item.votes[p.id])?.emoji} ${activity(item.votes[p.id])?.title}`
                : item.publishedAt
                  ? "Без голоса"
                  : item.participation.includes(p.id)
                    ? "Выбор пока тайный"
                    : "Не голосовал(а)"}
            </strong>
            {!!item.awardedStars[p.id] && (
              <span className="badge">+{item.awardedStars[p.id]} ★</span>
            )}
          </div>
        ))
      )}
      {item.resolutionType === "lottery" && (
        <small>Победителя выбрала честная жеребьёвка</small>
      )}
    </div>
  );
  return (
    <>
      <header>
        <a href="#" className="brand" onClick={() => setPage("home")}>
          🏡{" "}
          <span>
            Семейный
            <br />
            парламент
          </span>
        </a>
        <nav>
          {[
            ["home", "Эта неделя"],
            ["history", "История"],
            ["settings", "Настройки"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => setPage(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="identity">
          {participant.avatar} <span>{participant.name}</span>
        </div>
      </header>
      <main className="shell">
        {alert}
        {page === "home" && (
          <>
            <section className="intro">
              <div>
                <div className="eyebrow">ВРЕМЯ БЫТЬ ВМЕСТЕ</div>
                <h1>
                  {v?.status === "open"
                    ? "Как проведём субботу?"
                    : v?.status === "scheduled"
                      ? "У нас есть семейный план!"
                      : "До новой семейной недели"}
                </h1>
                <p>
                  {v?.status === "open"
                    ? "Выбирай сердцем. Остальные узнают твой выбор, когда придёт время."
                    : "Каждое маленькое приключение становится нашей общей историей."}
                </p>
              </div>
              {v && (
                <div className="date">
                  <span>БЛИЖАЙШАЯ СУББОТА</span>
                  <strong>{formatDate(v.scheduledDate)}</strong>
                  <small>
                    {v.scheduledDate <= data.today
                      ? "Можно подтвердить проведение"
                      : `Через ${Math.round((Date.parse(v.scheduledDate) - Date.parse(data.today)) / 86400000)} дн.`}
                  </small>
                </div>
              )}
            </section>
            {v?.status === "open" && (
              <>
                <section className="participation">
                  <div>
                    <strong>Наши три голоса</strong>
                    <p>Результат после всех голосов или в субботу</p>
                  </div>
                  <div className="people">
                    {data.participants.map((p) => (
                      <div key={p.id}>
                        <span className="face">{p.avatar}</span>
                        <span>
                          {p.name}
                          <small>
                            {v.participation.includes(p.id)
                              ? "✓ Голос принят"
                              : "Пока выбирает"}
                          </small>
                        </span>
                      </div>
                    ))}
                  </div>
                  <span className="count">{v.participation.length} / 3</span>
                </section>
                <div className="section-heading">
                  <h2>
                    Идеи для нашей субботы <span>{v.activityIds.length}</span>
                  </h2>
                  <span>Каждый выбор имеет значение</span>
                </div>
                <div className="cards">
                  {v.activityIds.map((id) => {
                    const a = activity(id)!;
                    const chosen = v.votes[me] === id;
                    return (
                      <button
                        className={`card ${chosen ? "chosen" : ""}`}
                        key={id}
                        onClick={() => setSelected(a)}
                      >
                        <div className="picture">
                          <img src={a.image} alt="" />
                          {chosen && (
                            <span className="chosen-label">✓ Твой выбор</span>
                          )}
                        </div>
                        <div className="card-content">
                          <h3>{a.title}</h3>
                          <p>{a.shortDescription}</p>
                          {stars(id)}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <aside className="star-note">
                  <span>🌟</span>
                  <div>
                    <strong>У каждого желания есть своя очередь</strong>
                    <p>
                      Не победил? Твоё желание получает звёзды. Соберёшь три — и
                      мы обязательно его исполним.
                    </p>
                  </div>
                </aside>
              </>
            )}
            {v?.status === "scheduled" && winner && (
              <section className="winner">
                <img src={winner.image} alt="" />
                <div>
                  <span className="eyebrow">
                    {v.resolutionType === "guaranteed"
                      ? "ЖЕЛАНИЕ ИСПОЛНЯЕТСЯ"
                      : "ВЫБОР НАШЕЙ СЕМЬИ"}
                  </span>
                  <h2>{winner.title}</h2>
                  <p>{winner.description}</p>
                  {results(v)}
                  <button
                    className="primary"
                    disabled={busy || v.scheduledDate > data.today}
                    onClick={() => setConfirm("complete")}
                  >
                    ✓ Событие состоялось
                  </button>
                  {v.scheduledDate > data.today && (
                    <small>
                      Подтвердить можно с {formatDate(v.scheduledDate)}
                    </small>
                  )}
                </div>
              </section>
            )}
            {v && (v.status === "completed" || v.status === "skipped") && (
              <section className="empty">
                <span>🌿</span>
                <h2>
                  {v.status === "completed"
                    ? "Ещё одно тёплое воспоминание"
                    : "Эту неделю пропускаем"}
                </h2>
                <p>Новое голосование откроется в субботу.</p>
              </section>
            )}
            {!!data.state.queue.length && (
              <section className="queue">
                <h2>Желания, которые исполнятся</h2>
                {data.state.queue.map((q, i) => (
                  <div key={q.activityId}>
                    <span>{i + 1}</span> {activity(q.activityId)?.emoji}{" "}
                    <strong>{activity(q.activityId)?.title}</strong>
                    <small>
                      {q.participantIds
                        .map(
                          (id) =>
                            data.participants.find((p) => p.id === id)?.name,
                        )
                        .join(", ")}{" "}
                      · ★★★
                    </small>
                  </div>
                ))}
              </section>
            )}
            {me !== "daughter" &&
              v &&
              ["open", "scheduled"].includes(v.status) && (
                <button className="subtle" onClick={() => setConfirm("skip")}>
                  Пропустить эту неделю
                </button>
              )}
          </>
        )}
        {page === "history" && (
          <>
            <div className="eyebrow">НАШИ ОБЩИЕ ВОСПОМИНАНИЯ</div>
            <h1>Семейная история</h1>
            <div className="history">
              {[...data.state.votings]
                .reverse()
                .filter(
                  (x) =>
                    x.id !== v?.id ||
                    ["completed", "skipped"].includes(x.status),
                )
                .map((x) => (
                  <button key={x.id} onClick={() => setDetail(x)}>
                    <span className="history-emoji">
                      {activity(x.winnerActivityId)?.emoji || "📅"}
                    </span>
                    <span>
                      <strong>
                        {activity(x.winnerActivityId)?.title ||
                          "Семейная неделя"}
                      </strong>
                      <small>{formatDate(x.scheduledDate)}</small>
                    </span>
                    <span className="badge">
                      {
                        {
                          open: "Голосуем",
                          scheduled: "В планах",
                          completed: "Состоялось",
                          skipped: "Пропущено",
                        }[x.status]
                      }
                    </span>
                    <span>→</span>
                  </button>
                ))}
            </div>
            {data.state.votings.length <= 1 &&
              !["completed", "skipped"].includes(v?.status || "") && (
                <div className="empty">Наша история только начинается 🌱</div>
              )}
          </>
        )}
        {page === "settings" && (
          <section className="settings">
            <div className="eyebrow">ТВОЁ МЕСТО В ПАРЛАМЕНТЕ</div>
            <h1>
              {participant.avatar} {participant.name}
            </h1>
            <p>У каждого из нас равный голос.</p>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api("/auth/logout", "POST");
                  setData(undefined);
                  setMe(undefined);
                  setPage("home");
                })
              }
            >
              Выйти из аккаунта
            </button>
            <small>Семейный парламент · версия 1.0.0</small>
          </section>
        )}
        <footer>
          Сделано для наших суббот <span>♥</span>
        </footer>
      </main>
      {(selected || detail || confirm) && (
        <div
          className="overlay"
          onClick={() => {
            setSelected(undefined);
            setDetail(undefined);
            setConfirm(undefined);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            className="modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              aria-label="Закрыть"
              className="close"
              autoFocus
              onClick={() => {
                setSelected(undefined);
                setDetail(undefined);
                setConfirm(undefined);
              }}
            >
              ×
            </button>
            {selected && (
              <>
                <img src={selected.image} alt="" />
                <h2 id="dialog-title">{selected.title}</h2>
                <p>{selected.description}</p>
                {stars(selected.id)}
                <button
                  className="primary"
                  disabled={busy || v?.status !== "open"}
                  onClick={() =>
                    void run(async () => {
                      await api(`/votings/${v?.id}/vote`, "PUT", {
                        activityId: selected.id,
                      });
                      setSelected(undefined);
                      await refresh();
                    })
                  }
                >
                  {v?.votes[me] === selected.id
                    ? "Подтвердить мой выбор"
                    : "Хочу провести субботу так!"}
                </button>
                <small>
                  До третьего голоса или субботы выбор можно изменить.
                </small>
              </>
            )}
            {detail && (
              <>
                <h2 id="dialog-title">{formatDate(detail.scheduledDate)}</h2>
                <h3>
                  {activity(detail.winnerActivityId)?.title ||
                    "Семейная неделя"}
                </h3>
                {results(detail)}
                {detail.completedAt && (
                  <p>
                    Подтверждено:{" "}
                    {new Date(detail.completedAt).toLocaleDateString("ru")}
                  </p>
                )}
              </>
            )}
            {confirm && (
              <>
                <h2 id="dialog-title">
                  {confirm === "complete"
                    ? "Событие состоялось?"
                    : "Пропустить эту неделю?"}
                </h2>
                <p>
                  {confirm === "complete"
                    ? "Сохраним воспоминание в истории и обнулим звёзды за это мероприятие."
                    : "Звёзды и очередь желаний сохранятся. Вернуть эту неделю будет нельзя."}
                </p>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api(`/votings/${v?.id}/${confirm}`, "POST");
                      setConfirm(undefined);
                      await refresh();
                    })
                  }
                >
                  Да, подтверждаю
                </button>
              </>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
