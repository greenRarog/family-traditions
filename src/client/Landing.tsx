import { useEffect, useRef, useState } from "react";
import { ProjectFooter } from "./ProjectFooter";

export function Landing({
  login,
  busy,
  error,
}: {
  login: (password: string) => Promise<void>;
  busy: boolean;
  error: string;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="landing">
      <header className="landing-header">
        <a className="landing-home" href="https://konushenko.ru">
          ← Все проекты
        </a>
        <div className="login-menu" ref={panel}>
          <button
            ref={button}
            className="login-toggle"
            aria-expanded={open}
            aria-controls="login-form"
            onClick={() => setOpen(!open)}
          >
            Войти <span aria-hidden="true">{open ? "−" : "+"}</span>
          </button>
          {open && (
            <form
              id="login-form"
              className="login-box login-dropdown"
              onSubmit={(event) => {
                event.preventDefault();
                void login(password);
              }}
            >
              <label htmlFor="password">Твой семейный пароль</label>
              <input
                ref={input}
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button className="primary" disabled={busy}>
                {busy ? "Входим…" : "Войти в парламент →"}
              </button>
              {error && (
                <div role="alert" className="error">
                  {error}
                </div>
              )}
              <small>Для участников семьи</small>
            </form>
          )}
        </div>
      </header>
      <main className="landing-main">
        <div className="landing-copy">
          <div className="eyebrow">
            МАЛЕНЬКИЕ ТРАДИЦИИ · БОЛЬШИЕ ВОСПОМИНАНИЯ
          </div>
          <h1>
            Семейный
            <br />
            парламент<span className="dot">.</span>
          </h1>
          <p className="landing-lead">Три голоса. Одна прекрасная суббота.</p>
          <p>
            Небольшое приложение, которое помогает семье выбирать, как провести
            выходные вместе. Каждый голосует за своё занятие, а желания, которые
            пока не победили, постепенно получают приоритет.
          </p>
          <a
            className="github-link"
            href="https://github.com/greenRarog/family-traditions"
          >
            Исходный код на GitHub <span aria-hidden="true">↗</span>
          </a>
          {!open && error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
        </div>
        <div className="login-art" aria-hidden="true">
          🏡
          <span>
            Выходные, которых
            <br />
            ждёт вся семья
          </span>
        </div>
        <section className="landing-how" aria-labelledby="how-title">
          <h2 id="how-title">Как рождается семейный план</h2>
          <ol>
            <li>
              <strong>Выбираем</strong>
              <p>
                Кино, прогулка или вечер настольных игр — у каждого свой голос.
              </p>
            </li>
            <li>
              <strong>Договариваемся</strong>
              <p>
                Побеждает большинство. При равенстве голосов помогает
                жеребьёвка.
              </p>
            </li>
            <li>
              <strong>Помним о каждом</strong>
              <p>
                Невыбранные желания копят звёзды. Три звезды — и занятие
                попадает в очередь обязательных событий.
              </p>
            </li>
          </ol>
        </section>
      </main>
      <ProjectFooter />
    </div>
  );
}
