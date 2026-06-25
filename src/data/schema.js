export const STORAGE_KEY = "summer-study-campus-v1";

export const createId = (prefix) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const dataShape = {
  subjects: [
    {
      id: "subject",
      name: "string",
      description: "string",
      color: "hex",
      icon: "string",
      targetDate: "YYYY-MM-DD",
      qa: [{ id: "qa", question: "string", answer: "string", status: "pendiente | repasando | dominada" }],
      themes: [
        {
          id: "theme",
          subjectId: "subject",
          name: "string",
          description: "string",
          status: "pendiente | en-curso | bloqueado | completado",
          priority: "baja | media | alta",
          targetDate: "YYYY-MM-DD",
          coverImage: "image URL or data URL for the theme cover",
          documentHtml: "HTML string with the main editable notes document",
          notes: [{ id: "note", title: "string", body: "string", createdAt: "ISO date" }],
          sections: [{ id: "section", title: "string", content: "string" }],
          media: [{ id: "media", type: "image | capture | pdf", name: "string", fileId: "IndexedDB file id" }],
          links: [{ id: "link", title: "string", url: "string" }],
          videos: [{ id: "video", title: "string", url: "string" }],
          exercises: [{ id: "exercise", title: "string", body: "string", solved: "boolean" }],
          doubts: [{ id: "doubt", question: "string", resolved: "boolean" }],
          checklist: [{ id: "check", label: "string", done: "boolean" }],
          resources: [{ id: "resource", title: "string", type: "string", url: "string" }],
        },
      ],
    },
  ],
  tasks: [
    {
      id: "task",
      subjectId: "subject | null",
      themeId: "theme | null",
      title: "string",
      dueDate: "YYYY-MM-DD",
      priority: "baja | media | alta",
      done: "boolean",
    },
  ],
  resources: [{ id: "resource", title: "string", type: "link | pdf | video | libro | otro", url: "string" }],
  events: [
    {
      id: "event",
      title: "string",
      description: "string",
      date: "YYYY-MM-DD",
      start: "HH:mm",
      end: "HH:mm",
      subjectId: "subject | null",
      source: "local",
    },
  ],
  scheduleBlocks: [
    {
      id: "block",
      day: "lunes | martes | miercoles | jueves | viernes | sabado | domingo",
      start: "HH:mm",
      end: "HH:mm",
      title: "string",
      subjectId: "subject | null",
    },
  ],
};

const today = new Date();
const iso = (offset) => {
  const d = new Date(today);
  d.setDate(today.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

const algorithmThemes = [
  ["Programación dinámica", "Subproblemas, recurrencias, memoización y tabulación.", "en-curso", "alta", "https://images.unsplash.com/photo-1555949963-aa79dcee981c?auto=format&fit=crop&w=900&q=80"],
  ["Algoritmos voraces", "Estrategias greedy, pruebas de optimalidad y contraejemplos.", "pendiente", "media", "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=80"],
  ["Grafos", "BFS, DFS, caminos mínimos, árboles generadores y conectividad.", "en-curso", "alta", "https://images.unsplash.com/photo-1635070041078-e363dbe005cb?auto=format&fit=crop&w=900&q=80"],
  ["Árboles", "Recorridos, heaps, BST, balanceo y aplicaciones.", "pendiente", "media", "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=900&q=80"],
  ["Recurrencias", "Método maestro, sustitución y árboles de recursión.", "pendiente", "alta", "https://images.unsplash.com/photo-1509228627152-72ae9ae6848d?auto=format&fit=crop&w=900&q=80"],
];

export const initialData = {
  subjects: [
    {
      id: "sub_algoritmos",
      name: "Diseño de Algoritmos",
      description: "Espacio tactico para practicar, demostrar y resolver problemas.",
      color: "#2f6f73",
      icon: "network",
      targetDate: iso(48),
      qa: [
        {
          id: createId("qa"),
          question: "¿Qué caracteriza a un problema resoluble con programación dinámica?",
          answer: "Que presenta subestructura óptima y subproblemas solapados, de modo que conviene guardar resultados parciales.",
          status: "pendiente",
        },
      ],
      themes: algorithmThemes.map(([name, description, status, priority, coverImage], index) => ({
        id: `theme_alg_${index}`,
        subjectId: "sub_algoritmos",
        name,
        description,
        status,
        priority,
        targetDate: iso(7 + index * 6),
        coverImage,
        documentHtml: `<h1>${name}</h1><p>${description}</p><h2>Apuntes principales</h2><p>${
          index === 0
            ? "Identificar el estado antes de escribir la transición. Después definir la recurrencia, el caso base y el orden de cálculo."
            : "Crear un resumen con definición, patrón y ejercicio tipo."
        }</p><h2>Ejercicio tipo</h2><p>Resolver un problema base y explicar la complejidad paso a paso.</p>`,
        notes: [
          {
            id: createId("note"),
            title: "Idea clave",
            body: index === 0 ? "Identificar el estado antes de escribir la transición." : "Crear un resumen con definición, patrón y ejercicio tipo.",
            createdAt: new Date().toISOString(),
          },
        ],
        sections: [{ id: createId("section"), title: "Mapa del tema", content: "Definiciones, casos frecuentes y ejercicios resueltos." }],
        media: [],
        links: [{ id: createId("link"), title: "Repositorio de prácticas", url: "https://example.com" }],
        videos: [],
        exercises: [{ id: createId("exercise"), title: "Ejercicio base", body: "Resolver y explicar la complejidad.", solved: false }],
        doubts: [{ id: createId("doubt"), question: "¿Qué condiciones garantizan que este enfoque aplica?", resolved: false }],
        checklist: [
          { id: createId("check"), label: "Resumen propio", done: false },
          { id: createId("check"), label: "Tres ejercicios", done: false },
          { id: createId("check"), label: "Repaso activo", done: false },
        ],
        resources: [],
      })),
    },
    {
      id: "sub_ingles",
      name: "Inglés",
      description: "Lectura, escucha, vocabulario útil y práctica oral.",
      color: "#c8505b",
      icon: "languages",
      targetDate: iso(55),
      qa: [],
      themes: [],
    },
    {
      id: "sub_calculo",
      name: "Cálculo",
      description: "Límites, derivadas, integrales y series con ejercicios diarios.",
      color: "#6d5bd0",
      icon: "sigma",
      targetDate: iso(52),
      qa: [],
      themes: [],
    },
    {
      id: "sub_algebra",
      name: "Álgebra",
      description: "Matrices, espacios vectoriales, diagonalización y sistemas.",
      color: "#d8892f",
      icon: "grid",
      targetDate: iso(50),
      qa: [],
      themes: [],
    },
    {
      id: "sub_fisica",
      name: "Física",
      description: "Problemas guiados, fórmulas y repaso visual por bloques.",
      color: "#33805f",
      icon: "atom",
      targetDate: iso(58),
      qa: [],
      themes: [],
    },
  ],
  tasks: [
    { id: "task_1", subjectId: "sub_algoritmos", themeId: "theme_alg_0", title: "Resolver mochila 0/1", dueDate: iso(2), priority: "alta", done: false },
    { id: "task_2", subjectId: "sub_calculo", themeId: null, title: "20 integrales por partes", dueDate: iso(3), priority: "media", done: false },
    { id: "task_3", subjectId: "sub_ingles", themeId: null, title: "Speaking de 15 minutos", dueDate: iso(1), priority: "baja", done: true },
  ],
  resources: [
    { id: "res_1", title: "Lista general de ejercicios", type: "link", url: "https://example.com" },
    { id: "res_2", title: "Banco de fórmulas", type: "pdf", url: "" },
  ],
  events: [],
  scheduleBlocks: [
    { id: "block_1", day: "lunes", start: "09:00", end: "10:30", title: "Algoritmos", subjectId: "sub_algoritmos" },
    { id: "block_2", day: "martes", start: "11:00", end: "12:00", title: "Inglés activo", subjectId: "sub_ingles" },
    { id: "block_3", day: "miercoles", start: "09:00", end: "10:15", title: "Cálculo", subjectId: "sub_calculo" },
    { id: "block_4", day: "jueves", start: "12:00", end: "13:00", title: "Álgebra", subjectId: "sub_algebra" },
    { id: "block_5", day: "viernes", start: "10:00", end: "11:30", title: "Física", subjectId: "sub_fisica" },
  ],
};
