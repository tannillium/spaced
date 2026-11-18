export type TiptapDoc = { type: "doc"; content?: Array<Record<string, unknown>>; [key: string]: unknown };
export type Page = {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: string;
  icon: string;
  favorite: boolean;
  blocks: TiptapDoc;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
};
export type DocumentFile = {
  id: string;
  source_page_id: string | null;
  name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  file_url: string;
};
export type SearchHit = { source_id: string; source_type: "page" | "document"; title: string; excerpt: string; score: number };
export type Citation = SearchHit;
export type ChatMessage = { role: "user" | "assistant"; content: string; citations?: Citation[] };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...init?.headers } });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try { const body = await response.json(); message = body.detail || message; } catch { /* Keep the HTTP message. */ }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  pages: () => request<Page[]>("/pages"),
  openPage: (id: string) => request<Page>(`/pages/${id}/open`, { method: "POST" }),
  createPage: (payload: Partial<Page> & { title?: string; parent_id?: string | null }) => request<Page>("/pages", { method: "POST", body: JSON.stringify(payload) }),
  updatePage: (id: string, payload: Partial<Pick<Page,"title"|"parent_id"|"icon"|"favorite"|"blocks">>) => request<Page>(`/pages/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deletePage: (id: string) => request<void>(`/pages/${id}`, { method: "DELETE" }),
  documents: () => request<DocumentFile[]>("/documents"),
  upload: (file: File, pageId?: string) => {
    const body = new FormData(); body.append("file", file);
    const query = pageId ? `?source_page_id=${encodeURIComponent(pageId)}` : "";
    return request<DocumentFile>(`/documents${query}`, { method: "POST", body });
  },
  deleteDocument: (id: string) => request<void>(`/documents/${id}`, { method: "DELETE" }),
  search: (query: string) => request<SearchHit[]>(`/search?q=${encodeURIComponent(query)}`),
  chat: (query: string, history: ChatMessage[], currentPageId?: string) => request<{ answer: string; citations: Citation[] }>("/chat", { method: "POST", body: JSON.stringify({ query, history: history.filter(message=>message.role).slice(-8).map(({role,content})=>({role,content})), current_page_id: currentPageId || null }) }),
};
