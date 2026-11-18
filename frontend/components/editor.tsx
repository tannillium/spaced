"use client";

import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Code2, Heading1, Heading2, ImagePlus, Italic, List, ListChecks, Quote, Table2, Underline } from "lucide-react";
import type { TiptapDoc } from "./api";
import { api, type DocumentFile } from "./api";

type SlashCommand = { id: string; label: string; detail: string; icon: string };
type SlashMenuState = { from: number; to: number; query: string; selected: number } | null;
type Props = { pageId: string; content: TiptapDoc; onChange: (value: TiptapDoc) => void; onUploadedFile: (document: DocumentFile) => void };

const slashCommands: SlashCommand[] = [
  { id: "paragraph", label: "Text", detail: "Plain text for your thoughts", icon: "T" },
  { id: "heading1", label: "Heading 1", detail: "Large section heading", icon: "H1" },
  { id: "heading2", label: "Heading 2", detail: "Medium section heading", icon: "H2" },
  { id: "bullet", label: "Bulleted list", detail: "A simple list", icon: "•" },
  { id: "task", label: "To-do list", detail: "Track something to do", icon: "☑" },
  { id: "quote", label: "Quote", detail: "Capture a useful line", icon: "“" },
  { id: "code", label: "Code", detail: "Add a code snippet", icon: "</>" },
  { id: "table", label: "Simple table", detail: "Add an editable grid", icon: "▦" },
  { id: "image", label: "Image", detail: "Add an image from your device", icon: "▧" },
];

export default function BlockEditor({ pageId, content, onChange, onUploadedFile }: Props) {
  const [slashMenu, setSlashMenu] = useState<SlashMenuState>(null);
  const imageInput=useRef<HTMLInputElement>(null);
  const [imageError,setImageError]=useState("");
  const onEditorUpdate = useCallback(({ editor }: { editor: Editor }) => {
    onChange(editor.getJSON() as TiptapDoc);
    const selection = editor.state.selection;
    if (!selection.empty) { setSlashMenu(null); return; }
    const cursor = selection.$from;
    const before = cursor.parent.textContent.slice(0, cursor.parentOffset);
    const match = before.match(/(?:^|\s)\/([\p{L}\p{N} ]*)$/u);
    if (!match) { setSlashMenu(null); return; }
    const slashOffset = match.index! + match[0].lastIndexOf("/");
    setSlashMenu({ from: cursor.start() + slashOffset, to: selection.from, query: match[1].trim().toLowerCase(), selected: 0 });
  }, [onChange]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: true } }),
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder: "Type something, or press '/' for commands…" }),
    ],
    content,
    immediatelyRender: false,
    editorProps: { attributes: { class: "tiptap-content", spellcheck: "true" } },
    onUpdate: onEditorUpdate,
  }, [pageId]);

  const filteredCommands = slashCommands.filter(command => !slashMenu?.query || `${command.label} ${command.detail}`.toLowerCase().includes(slashMenu.query));
  const runSlashCommand = (command: SlashCommand) => {
    if (!editor || !slashMenu) return;
    editor.chain().focus().deleteRange({ from: slashMenu.from, to: slashMenu.to }).run();
    setSlashMenu(null);
    switch (command.id) {
      case "paragraph": editor.chain().focus().setParagraph().run(); break;
      case "heading1": editor.chain().focus().toggleHeading({ level: 1 }).run(); break;
      case "heading2": editor.chain().focus().toggleHeading({ level: 2 }).run(); break;
      case "bullet": editor.chain().focus().toggleBulletList().run(); break;
      case "task": editor.chain().focus().toggleTaskList().run(); break;
      case "quote": editor.chain().focus().toggleBlockquote().run(); break;
      case "code": editor.chain().focus().toggleCodeBlock().run(); break;
      case "table": editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run(); break;
      case "image": imageInput.current?.click(); break;
    }
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!slashMenu) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setSlashMenu(menu => menu ? { ...menu, selected: (menu.selected + (event.key === "ArrowDown" ? 1 : filteredCommands.length - 1)) % Math.max(1, filteredCommands.length) } : null);
    } else if (event.key === "Enter" && filteredCommands.length) {
      event.preventDefault(); runSlashCommand(filteredCommands[slashMenu.selected] || filteredCommands[0]);
    } else if (event.key === "Escape") {
      event.preventDefault(); setSlashMenu(null);
    }
  };

  if (!editor) return <div className="editor-loading">Loading editor…</div>;
  const chooseImage=()=>imageInput.current?.click();
  const tool = (label: string, icon: ReactNode, run: () => void, active = false) => <button type="button" className={`editor-tool ${active ? "is-active" : ""}`} title={label} aria-label={label} onMouseDown={event => event.preventDefault()} onClick={run}>{icon}</button>;
  return <div className="editor-shell" onKeyDownCapture={handleEditorKeyDown}>
    <div className="editor-toolbar" role="toolbar" aria-label="Text formatting">
      {tool("Bold", <Bold size={15}/>, () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"))}
      {tool("Italic", <Italic size={15}/>, () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"))}
      {tool("Underline", <Underline size={15}/>, () => editor.chain().focus().toggleUnderline().run(), editor.isActive("underline"))}
      <span className="editor-divider"/>
      {tool("Heading 1", <Heading1 size={16}/>, () => editor.chain().focus().toggleHeading({level:1}).run(), editor.isActive("heading",{level:1}))}
      {tool("Heading 2", <Heading2 size={16}/>, () => editor.chain().focus().toggleHeading({level:2}).run(), editor.isActive("heading",{level:2}))}
      {tool("Bulleted list", <List size={16}/>, () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"))}
      {tool("To-do list", <ListChecks size={16}/>, () => editor.chain().focus().toggleTaskList().run(), editor.isActive("taskList"))}
      {tool("Quote", <Quote size={15}/>, () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"))}
      {tool("Code block", <Code2 size={15}/>, () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive("codeBlock"))}
      <span className="editor-divider"/>
      {tool("Insert table", <Table2 size={15}/>, () => editor.chain().focus().insertTable({rows:2,cols:2,withHeaderRow:true}).run())}
      {tool("Insert image", <ImagePlus size={15}/>, chooseImage)}
    </div>
    <div className="editor-surface"><EditorContent editor={editor}/>
      {slashMenu && <div className="slash-menu" role="listbox" aria-label="Insert block">{filteredCommands.length ? filteredCommands.map((command,index)=><button key={command.id} type="button" role="option" aria-selected={index===slashMenu.selected} className={index===slashMenu.selected?"is-selected":""} onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>setSlashMenu(menu=>menu?{...menu,selected:index}:null)} onClick={()=>runSlashCommand(command)}><span className="slash-icon">{command.icon}</span><span className="slash-command-copy"><strong>{command.label}</strong><small>{command.detail}</small></span></button>) : <div className="slash-no-match">No matching blocks</div>}</div>}
    </div>
    <p className="editor-help">Type <kbd>/</kbd> to insert a block. Changes save to your workspace automatically.</p>
    {imageError&&<p className="editor-error">{imageError}</p>}
    <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async event=>{const file=event.target.files?.[0];if(!file)return;setImageError("");try{const uploaded=await api.upload(file,pageId);onUploadedFile(uploaded);editor.chain().focus().setImage({src:uploaded.file_url,alt:file.name}).run();}catch(error){setImageError(error instanceof Error?error.message:"Image upload failed");}finally{event.target.value="";}}}/>
  </div>;
}
