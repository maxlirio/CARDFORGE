// Minimal promise-based modal helpers.

export function modal({ title, body, confirmText = "OK", cancelText = "Cancel", onMount }) {
  return new Promise((resolve) => {
    const root = document.getElementById("modal-root");
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const box = document.createElement("div");
    box.className = "modal";
    box.innerHTML = `<h2>${title}</h2>`;
    if (typeof body === "string") {
      const p = document.createElement("div");
      p.innerHTML = body;
      box.appendChild(p);
    } else if (body) {
      box.appendChild(body);
    }
    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const cancel = document.createElement("button");
    cancel.className = "btn btn-ghost";
    cancel.textContent = cancelText;
    const ok = document.createElement("button");
    ok.className = "btn btn-primary";
    ok.textContent = confirmText;
    actions.append(cancel, ok);
    box.appendChild(actions);
    backdrop.appendChild(box);
    root.appendChild(backdrop);

    const close = (val) => { root.removeChild(backdrop); resolve(val); };
    cancel.addEventListener("click", () => close(null));
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(null); });
    const api = { close, box };
    ok.addEventListener("click", () => close(api._collect ? api._collect() : true));
    onMount?.(api);
    return api;
  });
}

export async function promptText({ title, value = "", placeholder = "" }) {
  const wrap = document.createElement("div");
  wrap.className = "prop-row full";
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  wrap.appendChild(input);
  let collected = null;
  const result = await modal({
    title,
    body: wrap,
    onMount: (api) => {
      api._collect = () => input.value.trim();
      setTimeout(() => { input.focus(); input.select(); }, 10);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") api.close(input.value.trim()); });
    },
  });
  return result === null ? null : result;
}
