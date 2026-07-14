const DEFAULT_REPO = "rafadag07/AppStudios";
const DEFAULT_BRANCH = "main";
const DEFAULT_PATH = "appstudios-cloud/data.json";

function sendJson(res, response, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(response));
}

function getConfig() {
  return {
    token: process.env.GITHUB_SYNC_TOKEN,
    repo: process.env.GITHUB_SYNC_REPO || DEFAULT_REPO,
    branch: process.env.GITHUB_SYNC_BRANCH || DEFAULT_BRANCH,
    path: process.env.GITHUB_SYNC_PATH || DEFAULT_PATH,
  };
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

async function githubRequest(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.message || `GitHub ha respondido con error ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function decodeBase64(content = "") {
  return Buffer.from(content.replace(/\n/g, ""), "base64").toString("utf8");
}

function encodeBase64(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

async function readFileText(file, config) {
  if (file.content && file.encoding === "base64") {
    return decodeBase64(file.content);
  }
  if (file.git_url) {
    const blob = await githubRequest(file.git_url, config.token);
    if (blob.content && blob.encoding === "base64") {
      return decodeBase64(blob.content);
    }
  }
  throw new Error("GitHub no ha devuelto el contenido de la copia. Prueba a subirla de nuevo desde el dispositivo correcto.");
}

async function readCloudFile(config) {
  const url = `https://api.github.com/repos/${config.repo}/contents/${encodeURIComponent(config.path).replaceAll("%2F", "/")}?ref=${encodeURIComponent(config.branch)}`;
  try {
    const file = await githubRequest(url, config.token);
    const text = await readFileText(file, config);
    const parsed = JSON.parse(text);
    const data = parsed.data || (parsed.subjects ? parsed : null);
    return {
      exists: true,
      sha: file.sha,
      updatedAt: parsed.updatedAt || null,
      data,
      compressedData: parsed.compressedData || null,
      encoding: parsed.encoding || null,
    };
  } catch (error) {
    if (error.status === 404) return { exists: false, sha: null, updatedAt: null, data: null };
    throw error;
  }
}

async function writeCloudFile(config, data, compressedData = null) {
  const current = await readCloudFile(config);
  const updatedAt = new Date().toISOString();
  const payload = {
    app: "AppStudios",
    updatedAt,
    ...(compressedData ? { encoding: "gzip-base64-json", compressedData } : { data }),
  };
  const url = `https://api.github.com/repos/${config.repo}/contents/${encodeURIComponent(config.path).replaceAll("%2F", "/")}`;
  const body = {
    message: `Actualizar copia AppStudios ${updatedAt}`,
    content: encodeBase64(JSON.stringify(payload, null, 2)),
    branch: config.branch,
    ...(current.sha ? { sha: current.sha } : {}),
  };
  await githubRequest(url, config.token, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: true, updatedAt };
}

export default async function handler(req, res) {
  const config = getConfig();
  if (!config.token) {
    return sendJson(res, { error: "Falta configurar GITHUB_SYNC_TOKEN en Vercel." }, 500);
  }

  try {
    if (req.method === "GET") {
      const file = await readCloudFile(config);
      return sendJson(res, file);
    }

    if (req.method === "POST") {
      const body = parseBody(req);
      const data = body.data || null;
      const compressedData = typeof body.compressedData === "string" ? body.compressedData : null;
      if (!compressedData && (!data?.subjects || !Array.isArray(data.subjects))) {
        return sendJson(res, { error: "Los datos recibidos no son una copia valida de AppStudios." }, 400);
      }
      const result = await writeCloudFile(config, data, compressedData);
      return sendJson(res, result);
    }

    return sendJson(res, { error: "Metodo no permitido." }, 405);
  } catch (error) {
    console.error(error);
    return sendJson(res, { error: error.message || "Error en la nube manual." }, error.status && error.status < 500 ? error.status : 500);
  }
}
