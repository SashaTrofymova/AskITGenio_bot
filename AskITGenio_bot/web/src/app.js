const messages = document.querySelector("#messages");
const form = document.querySelector("#askForm");
const input = document.querySelector("#questionInput");
const serverStatus = document.querySelector("#serverStatus");
const kbStatus = document.querySelector("#kbStatus");
const sheetsStatus = document.querySelector("#sheetsStatus");
const genaStatus = document.querySelector("#genaStatus");
const notionStatus = document.querySelector("#notionStatus");

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function addMessage(role, html) {
  const item = document.createElement("article");
  item.className = `message ${role}`;
  item.innerHTML = `<div class="message-label">${role === "user" ? "Вы" : "Бот"}</div>${html}`;
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
}

function renderSources(sources = []) {
  if (!sources.length) return "";

  const items = sources
    .map((source) => {
      const title = escapeHtml(source.title || source.type || "Источник");
      const detail = escapeHtml(source.detail || "");
      return `<li><strong>${title}</strong>${detail ? `<span>${detail}</span>` : ""}</li>`;
    })
    .join("");

  return `<details class="sources" open><summary>Источники</summary><ul>${items}</ul></details>`;
}

function renderNotion(matches = []) {
  if (!matches.length) return "";

  const items = matches
    .map((match) => `<li><strong>${escapeHtml(match.title)}</strong><span>${escapeHtml(match.snippet)}</span></li>`)
    .join("");

  return `<details class="sources"><summary>Похожие заметки Notion</summary><ul>${items}</ul></details>`;
}

async function ask(question) {
  addMessage("user", `<p>${escapeHtml(question)}</p>`);
  addMessage("bot", `<p class="muted">Ищу в таблице, Гене и Notion...</p>`);

  const pending = messages.lastElementChild;
  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    pending.innerHTML = `
      <div class="message-label">Бот</div>
      <p>${escapeHtml(data.answer).replaceAll("\n", "<br>")}</p>
      ${renderSources(data.sources)}
      ${renderNotion(data.notionMatches)}
    `;
  } catch (error) {
    pending.innerHTML = `
      <div class="message-label">Бот</div>
      <p>Не смогла получить ответ от локального сервера. Проверьте, что он запущен.</p>
      <p class="error">${escapeHtml(error.message)}</p>
    `;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const question = input.value.trim();
  if (!question) return;
  input.value = "";
  ask(question);
});

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    const prompt = button.dataset.prompt;
    input.value = prompt;
    ask(prompt);
  });
});

async function loadStatus() {
  try {
    const response = await fetch("/api/status");
    const data = await response.json();

    serverStatus.textContent = "подключено";
    serverStatus.classList.add("ready");
    kbStatus.textContent = `${data.knowledgeBaseRows} вопросов`;
    sheetsStatus.textContent = `${data.indexedSheetRows} строк`;
    genaStatus.textContent = `${data.genaDirections} направлений`;
    notionStatus.textContent = `${data.notionPages} страниц`;
  } catch {
    serverStatus.textContent = "нет сервера";
    serverStatus.classList.add("error-pill");
    kbStatus.textContent = "не подключена";
    sheetsStatus.textContent = "не подключены";
    genaStatus.textContent = "не подключена";
    notionStatus.textContent = "не подключен";
  }
}

loadStatus();
