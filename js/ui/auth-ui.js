// Login / signup wall.

import { signIn, signUp, CLOUD } from "../supabase.js";

let mode = "signin"; // signin | signup

export function initAuthUI(onAuthenticated) {
  const form = document.getElementById("auth-form");
  const toggle = document.getElementById("auth-toggle");
  const submit = document.getElementById("auth-submit");
  const errEl = document.getElementById("auth-error");

  toggle.addEventListener("click", () => {
    mode = mode === "signin" ? "signup" : "signin";
    submit.textContent = mode === "signin" ? "Sign in" : "Sign up";
    toggle.textContent =
      mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in";
    errEl.textContent = "";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.textContent = "";
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;
    submit.disabled = true;
    try {
      const session =
        mode === "signin" ? await signIn(email, password) : await signUp(email, password);
      if (!session && CLOUD) {
        errEl.textContent = "Check your email to confirm your account, then sign in.";
        mode = "signin";
        submit.textContent = "Sign in";
        return;
      }
      onAuthenticated(session);
    } catch (err) {
      errEl.textContent = err.message || "Authentication failed.";
    } finally {
      submit.disabled = false;
    }
  });
}
