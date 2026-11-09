export type Doc = {
  id: string;
  name: string;
  size: number;
  pages: number;
  created: string;
  sample: number;
  fields: Record<string, string>;
};
export type Source = {
  number: number;
  document_id: string;
  name: string;
  page: number;
  excerpt: string;
  score?: number;
};
export type Answer = {
  id: string;
  question: string;
  answer: string;
  sources: Source[];
  created: string;
  mode: string;
};
export type Health = {
  mode: string;
  embedding_model: string;
  chat_model: string;
  auth_required: boolean;
};
export type Activity = {
  id: number;
  action: string;
  detail: string;
  created: string;
};

export const getAccessToken = () => sessionStorage.getItem("kema-token") || "";
export function saveAccessToken(token: string) {
  if (token) sessionStorage.setItem("kema-token", token);
  else sessionStorage.removeItem("kema-token");
}

async function request(path: string, options: RequestInit = {}) {
  const token = getAccessToken();
  const response = await fetch("/api" + path, {
    ...options,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    if (response.status === 401) {
      saveAccessToken("");
      window.dispatchEvent(new Event("kema:unauthorized"));
    }
    const error = await response
      .json()
      .catch(() => ({ detail: "Could not connect to the workspace." }));
    throw Error(
      typeof error.detail === "string"
        ? error.detail
        : "Please check your input and try again.",
    );
  }
  return response;
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  return (await request(path, options)).json();
}

export async function downloadFile(path: string, name: string) {
  const url = URL.createObjectURL(await (await request(path)).blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
