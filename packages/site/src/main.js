// Copy buttons. The page works without this.
for (const btn of document.querySelectorAll("button.copy-btn")) {
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.copy ?? "");
      btn.textContent = "Copied";
    } catch {
      btn.textContent = "Select it";
    }
    setTimeout(() => (btn.textContent = "Copy"), 1600);
  });
}
