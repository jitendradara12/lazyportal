/**
 * The login screen is code-split so signed-in users never download it. First-time visitors would
 * otherwise wait for the entry bundle to run before even requesting it, so the shell preloads the
 * chunk in parallel when no session is stored. Same storage key as `session.createStore` in core.
 */
export function preloadLogin() {
  return {
    name: "preload-login-chunk",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html, { bundle }) {
        const login = Object.values(bundle ?? {}).find((chunk) => chunk.type === "chunk" && chunk.name === "LoginPage");
        if (!login) return html;
        // Its shared static imports too, or they would be discovered only after the chunk is parsed.
        const files = [login.fileName, ...login.imports.filter((file) => !bundle[file]?.isEntry)].map((file) => `/${file}`);
        const script = `<script>try{if(!localStorage.getItem("juet.portal.session.v1")){${JSON.stringify(files)}.forEach(function(h){var l=document.createElement("link");l.rel="modulepreload";l.href=h;document.head.appendChild(l)})}}catch(e){}</script>`;
        return html.replace("</head>", `${script}\n  </head>`);
      },
    },
  };
}
