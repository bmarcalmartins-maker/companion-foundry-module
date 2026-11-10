// O SAQUE (v1.25.0): a janela de pergaminho FORA do Foundry (qa/saque/janela.html),
// fotografada e medida. Fora do CI. Uso, da raiz do módulo:
//   node qa/saque/capturar.mjs
//
// O que confere, em 1440x900, iPhone (390x844, densidade 3) e iPad (820x1180,
// densidade 2):
//   - as fontes e as duas imagens do pergaminho carregaram (nenhum 404);
//   - o contraste de CADA texto da janela (WCAG 2: >= 4,5:1; >= 3:1 para texto
//     de 24 px ou de 18,66 px em negrito), contra o fundo de verdade dele: o
//     PIOR ponto do papel (#c79b5a) com o que estiver por cima (o fundo cheio
//     do botão "Pegar"). A cor computada passa por um canvas de 1x1, porque
//     getComputedStyle pode devolver rgb(), oklab(), color-mix()…;
//   - o foco visível em cada botão (contorno >= 2 px, >= 3:1 contra o papel);
//   - nada estoura a largura da tela; no toque, os botões têm 44 px.
// Não prova nada sobre o Foundry: a moldura em volta da folha é imitação.
import http from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "/opt/node-tools/node_modules/playwright/index.mjs";

const RAIZ = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SAIDA = join(RAIZ, "qa/saque/capturas");
const PIOR_PAPEL = [199, 155, 90]; // #c79b5a
const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const faltaram = [];
const servidor = http.createServer(async (req, res) => {
  const caminho = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
  const arquivo = join(RAIZ, caminho);
  if (!arquivo.startsWith(RAIZ)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const corpo = await readFile(arquivo);
    res.writeHead(200, { "content-type": TIPOS[extname(arquivo)] ?? "application/octet-stream", "cache-control": "no-store" }).end(corpo);
  } catch {
    if (!caminho.endsWith("favicon.ico")) faltaram.push(caminho);
    res.writeHead(404).end();
  }
});
await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${servidor.address().port}`;

const TELAS = [
  { nome: "computador-1440", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  { nome: "iphone-390", viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { nome: "ipad-820", viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];
const ESTADOS = ["", "erro", "espera", "tudo"];

/** Roda NA PÁGINA: mede os textos, o foco e a largura. */
function medirNaPagina(piorPapel) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  /** Qualquer cor do CSS → [r, g, b, a] (a de 0 a 1), pintando 1 px num canvas vazio. */
  const rgba = (cor) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = cor;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    if (a === 0) return [0, 0, 0, 0];
    // o canvas guarda a cor pré-multiplicada: com alfa < 1 o arredondamento
    // perde até 1 nível; basta para a medida
    return [r, g, b, a / 255];
  };
  const sobre = (cima, baixo) => {
    const a = cima[3];
    return [0, 1, 2].map((i) => cima[i] * a + baixo[i] * (1 - a));
  };
  const lum = (c) => {
    const [r, g, b] = c.map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const razao = (a, b) => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const folha = document.querySelector(".cfb-saque-perg");
  /** O fundo de verdade do elemento: o pior papel + os fundos dos que estão entre a folha e ele. */
  const fundoDe = (el) => {
    const pilha = [];
    for (let e = el; e && e !== folha; e = e.parentElement) pilha.unshift(e);
    let fundo = piorPapel;
    for (const e of pilha) {
      const st = getComputedStyle(e);
      const c = rgba(st.backgroundColor);
      if (c[3] > 0) fundo = sobre(c, fundo);
      const op = Number(st.opacity);
      if (op < 1) fundo = fundo; // a opacidade apaga o TEXTO junto: tratada em quem chama
    }
    return fundo;
  };
  const opacidadeDe = (el) => {
    let op = 1;
    for (let e = el; e && e !== folha.parentElement; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    return op;
  };

  const textos = [];
  const andar = document.createTreeWalker(folha, NodeFilter.SHOW_TEXT);
  const vistos = new Set();
  for (let n = andar.nextNode(); n; n = andar.nextNode()) {
    const t = n.textContent.replace(/\s+/g, " ").trim();
    const el = n.parentElement;
    if (!t || !el || vistos.has(el)) continue;
    vistos.add(el);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const st = getComputedStyle(el);
    const desligado = !!el.closest("button:disabled");
    const fundo = fundoDe(el);
    const corTexto = rgba(st.color);
    const cor = sobre([corTexto[0], corTexto[1], corTexto[2], corTexto[3] * opacidadeDe(el)], fundo);
    const px = parseFloat(st.fontSize);
    const negrito = Number(st.fontWeight) >= 700;
    const grande = px >= 24 || (px >= 18.66 && negrito);
    textos.push({
      texto: t.slice(0, 48),
      classe: el.className || el.tagName.toLowerCase(),
      px,
      negrito,
      familia: st.fontFamily.split(",")[0].replace(/"/g, ""),
      razao: razao(cor, fundo),
      minimo: grande ? 3 : 4.5,
      desligado,
    });
  }

  const estouros = [];
  const largura = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > largura + 0.5) estouros.push(`a página rola de lado (${document.documentElement.scrollWidth} > ${largura})`);
  if (folha.scrollWidth > folha.clientWidth + 0.5) estouros.push(`a folha rola de lado (${folha.scrollWidth} > ${folha.clientWidth})`);
  const app = document.querySelector(".cfb-saque-app");
  for (const el of [app, ...folha.querySelectorAll("*")]) {
    const r = el.getBoundingClientRect();
    if (r.width && (r.right > largura + 0.5 || r.left < -0.5)) estouros.push(`${el.className || el.tagName} sai da tela (${Math.round(r.left)} a ${Math.round(r.right)} de ${largura})`);
  }
  // dentro da folha: nada passa da caixa de dentro da moldura
  const dentro = folha.getBoundingClientRect();
  const bordaE = parseFloat(getComputedStyle(folha).borderLeftWidth);
  const bordaD = parseFloat(getComputedStyle(folha).borderRightWidth);
  for (const el of folha.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width && (r.right > dentro.right - bordaD + 0.5 || r.left < dentro.left + bordaE - 0.5)) estouros.push(`${el.className || el.tagName} passa por cima da moldura`);
  }

  const st = getComputedStyle(folha);
  return {
    textos,
    estouros,
    moldura: { fonte: st.borderImageSource, corte: st.borderImageSlice, repete: st.borderImageRepeat, largura: st.borderImageWidth, papel: st.backgroundImage },
    toque: matchMedia("(pointer: coarse)").matches,
    botoes: [...folha.querySelectorAll("button")].map((b) => {
      const r = b.getBoundingClientRect();
      return { texto: b.textContent.trim(), w: r.width, h: r.height, desligado: b.disabled };
    }),
  };
}

/** Roda NA PÁGINA, depois de um Tab: o contorno do foco de cada botão. */
function medirFoco(piorPapel) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const rgb = (cor) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = cor;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  };
  const lum = (c) => {
    const [r, g, b] = c.slice(0, 3).map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const saida = [];
  for (const b of document.querySelectorAll(".cfb-saque-perg button:not(:disabled)")) {
    b.focus();
    const st = getComputedStyle(b);
    const cor = rgb(st.outlineColor);
    const [x, y] = [lum(cor), lum(piorPapel)];
    saida.push({
      texto: b.textContent.trim(),
      visivel: b.matches(":focus-visible"),
      estilo: st.outlineStyle,
      largura: parseFloat(st.outlineWidth),
      razao: cor[3] === 0 ? 0 : (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05),
    });
  }
  return saida;
}

await mkdir(SAIDA, { recursive: true });
const navegador = await chromium.launch();
let falhas = 0;
const falhou = (frase) => {
  falhas++;
  console.log(`  FALHA  ${frase}`);
};

try {
  for (const tela of TELAS) {
    const contexto = await navegador.newContext(tela);
    for (const estado of ESTADOS) {
      const pagina = await contexto.newPage();
      const erros = [];
      pagina.on("pageerror", (e) => erros.push(String(e)));
      pagina.on("console", (m) => { if (m.type() === "error") erros.push(m.text()); });
      await pagina.goto(`${base}/qa/saque/janela.html${estado ? `?estado=${estado}` : ""}`, { waitUntil: "networkidle" });
      await pagina.waitForFunction(() => window.__pronto === true);
      // as cinco faces carregadas de verdade (document.fonts.check diz true também sem fonte nenhuma)
      const fontes = await pagina.evaluate(async () => {
        await Promise.all([
          document.fonts.load('16px "Scaly Sans"'),
          document.fonts.load('bold 16px "Scaly Sans"'),
          document.fonts.load('italic 16px "Scaly Sans"'),
          document.fonts.load('italic bold 16px "Scaly Sans"'),
          document.fonts.load('20px "Mr Eaves Small Caps"'),
        ]);
        await document.fonts.ready;
        return [...document.fonts].map((f) => `${f.family.replace(/"/g, "")} ${f.weight} ${f.style}: ${f.status}`);
      });
      const imagens = await pagina.evaluate(async () => {
        const st = getComputedStyle(document.querySelector(".cfb-saque-perg"));
        const urls = [st.borderImageSource, st.backgroundImage].map((v) => /url\("?([^")]+)"?\)/.exec(v)?.[1]);
        const saida = [];
        for (const u of urls) {
          const img = new Image();
          img.src = u;
          await img.decode().catch(() => {});
          saida.push({ u: u?.split("/").slice(-2).join("/"), w: img.naturalWidth, h: img.naturalHeight });
        }
        return saida;
      });
      const nome = `${tela.nome}${estado ? `-${estado}` : ""}`;
      // JPEG: o PNG do iPhone (densidade 3) pesa 4 MB; o contraste é medido no DOM, não na foto
      await pagina.screenshot({ path: join(SAIDA, `${nome}.jpg`), type: "jpeg", quality: 82, fullPage: true });
      const m = await pagina.evaluate(medirNaPagina, PIOR_PAPEL);

      console.log(`\n== ${nome} (${tela.viewport.width}x${tela.viewport.height}, densidade ${tela.deviceScaleFactor}${m.toque ? ", toque" : ""}) ==`);
      if (erros.length) falhou(`erros na página: ${erros.join(" | ")}`);
      const carregadas = fontes.filter((f) => f.endsWith("loaded"));
      if (carregadas.length < 5) falhou(`fontes: ${fontes.join("; ")}`);
      else if (!estado) console.log(`  OK     fontes carregadas: ${carregadas.length} faces`);
      for (const i of imagens) {
        if (!i.w) falhou(`imagem do pergaminho não carregou: ${i.u}`);
        else if (!estado) console.log(`  OK     ${i.u} ${i.w}x${i.h}`);
      }
      if (!/borda\.webp/.test(m.moldura.fonte) || m.moldura.corte !== "200" || m.moldura.repete !== "round" || !/papel\.webp/.test(m.moldura.papel)) {
        falhou(`a moldura não é a do pergaminho: ${JSON.stringify(m.moldura)}`);
      } else if (!estado) console.log(`  OK     moldura: borda.webp, corte ${m.moldura.corte}, ${m.moldura.repete}, ${m.moldura.largura}; papel.webp em azulejo`);

      for (const t of m.textos) {
        if (t.desligado) {
          console.log(`  --     ${t.razao.toFixed(2)}:1  (botão desligado, fora da regra)  "${t.texto}"`);
          continue;
        }
        const ok = t.razao >= t.minimo;
        if (!ok) falhas++;
        // no estado padrão, toda linha; nos outros, só o que falha e o que é novo
        if (!ok || !estado || /erro|decidido|rodape/.test(t.classe)) {
          console.log(`  ${ok ? "OK   " : "FALHA"}  ${t.razao.toFixed(2)}:1 (mín. ${t.minimo})  ${t.px}px${t.negrito ? " negrito" : ""} ${t.familia}  "${t.texto}"`);
        }
        if (!/Scaly Sans|Mr Eaves Small Caps/.test(t.familia)) falhou(`fonte fora do padrão em "${t.texto}": ${t.familia}`);
        if (t.px < 14) falhou(`letra pequena demais em "${t.texto}": ${t.px}px`);
      }
      if (m.estouros.length) for (const e of [...new Set(m.estouros)]) falhou(e);
      else console.log(`  OK     nada estoura a largura (${tela.viewport.width}px)`);

      if (m.toque) {
        const pequenos = m.botoes.filter((b) => b.h < 44 - 0.5 || b.w < 44 - 0.5);
        if (pequenos.length) for (const b of pequenos) falhou(`alvo de toque menor que 44 px: "${b.texto}" ${Math.round(b.w)}x${Math.round(b.h)}`);
        else console.log(`  OK     ${m.botoes.length} botões com 44 px ou mais no toque`);
      }

      await pagina.keyboard.press("Tab"); // o foco passa a ser "de teclado"
      const foco = await pagina.evaluate(medirFoco, PIOR_PAPEL);
      const semFoco = foco.filter((f) => !f.visivel || f.estilo === "none" || f.largura < 2 || f.razao < 3);
      if (semFoco.length) for (const f of semFoco) falhou(`foco invisível em "${f.texto}": ${JSON.stringify(f)}`);
      else if (foco.length) console.log(`  OK     foco visível nos ${foco.length} botões (contorno ${foco[0].largura}px, ${foco[0].razao.toFixed(2)}:1 no papel)`);
      if (!estado) {
        await pagina.evaluate(() => document.querySelector(".cfb-saque-perg button")?.focus());
        await pagina.screenshot({ path: join(SAIDA, `${tela.nome}-foco.jpg`), type: "jpeg", quality: 82, fullPage: true });
      }
      await pagina.close();
    }
    await contexto.close();
  }
} finally {
  await navegador.close();
  servidor.close();
}

if (faltaram.length) {
  falhas++;
  console.log(`\nFALHA  arquivos pedidos e não achados: ${[...new Set(faltaram)].join(", ")}`);
}
console.log(falhas ? `\n${falhas} FALHA(S)` : `\nTUDO OK. Capturas em qa/saque/capturas/`);
process.exit(falhas ? 1 : 0);
