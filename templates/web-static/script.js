// Runs once the page has loaded ("defer" in index.html).
document.querySelector("#greet").addEventListener("click", () => {
  document.querySelector("#message").textContent = "Hello from {{name}}!";
});
