import { CrepeBuilder } from "@milkdown/crepe/builder";
import { blockEdit } from "@milkdown/crepe/feature/block-edit";
import { cursor } from "@milkdown/crepe/feature/cursor";
import { linkTooltip } from "@milkdown/crepe/feature/link-tooltip";
import { listItem } from "@milkdown/crepe/feature/list-item";
import { placeholder } from "@milkdown/crepe/feature/placeholder";
import { table } from "@milkdown/crepe/feature/table";
import { toolbar } from "@milkdown/crepe/feature/toolbar";
import { topBar } from "@milkdown/crepe/feature/top-bar";
import "@milkdown/crepe/theme/common/prosemirror.css";
import "@milkdown/crepe/theme/common/reset.css";
import "@milkdown/crepe/theme/common/block-edit.css";
import "@milkdown/crepe/theme/common/cursor.css";
import "@milkdown/crepe/theme/common/link-tooltip.css";
import "@milkdown/crepe/theme/common/list-item.css";
import "@milkdown/crepe/theme/common/placeholder.css";
import "@milkdown/crepe/theme/common/table.css";
import "@milkdown/crepe/theme/common/toolbar.css";
import "@milkdown/crepe/theme/common/top-bar.css";
import "@milkdown/crepe/theme/frame.css";
import { Editor } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

type MarkdownMountOptions = {
  root: HTMLElement;
  initialMarkdown: string;
  placeholder?: string;
  onChange: (markdown: string) => void;
  onReady?: () => void;
  onError?: (error: unknown) => void;
};

type RichTextMountOptions = {
  root: HTMLElement;
  toolbar?: HTMLElement | null;
  initialHtml: string;
  initialMarkdown?: string;
  onChange: (html: string, text: string) => void;
  onReady?: () => void;
};

type MountedEditor = { destroy: () => void | Promise<void> };

const mounted = new Set<MountedEditor>();

function runTiptapCommand(editor: Editor, command: string): boolean {
  const chain = editor.chain().focus();
  switch (command) {
    case "bold": return chain.toggleBold().run();
    case "italic": return chain.toggleItalic().run();
    case "underline": return chain.toggleUnderline().run();
    case "paragraph": return chain.setParagraph().run();
    case "heading1": return chain.toggleHeading({ level: 1 }).run();
    case "heading2": return chain.toggleHeading({ level: 2 }).run();
    case "bulletList": return chain.toggleBulletList().run();
    case "orderedList": return chain.toggleOrderedList().run();
    case "blockquote": return chain.toggleBlockquote().run();
    case "alignLeft": return chain.setTextAlign("left").run();
    case "alignCenter": return chain.setTextAlign("center").run();
    case "alignRight": return chain.setTextAlign("right").run();
    case "alignJustify": return chain.setTextAlign("justify").run();
    case "undo": return chain.undo().run();
    case "redo": return chain.redo().run();
    default: return false;
  }
}

function commandIsActive(editor: Editor, command: string): boolean {
  switch (command) {
    case "bold": return editor.isActive("bold");
    case "italic": return editor.isActive("italic");
    case "underline": return editor.isActive("underline");
    case "paragraph": return editor.isActive("paragraph");
    case "heading1": return editor.isActive("heading", { level: 1 });
    case "heading2": return editor.isActive("heading", { level: 2 });
    case "bulletList": return editor.isActive("bulletList");
    case "orderedList": return editor.isActive("orderedList");
    case "blockquote": return editor.isActive("blockquote");
    case "alignLeft": return editor.isActive({ textAlign: "left" });
    case "alignCenter": return editor.isActive({ textAlign: "center" });
    case "alignRight": return editor.isActive({ textAlign: "right" });
    case "alignJustify": return editor.isActive({ textAlign: "justify" });
    default: return false;
  }
}

function mountToolbar(editor: Editor, toolbar?: HTMLElement | null): () => void {
  if (!toolbar) return () => undefined;
  const buttons = [...toolbar.querySelectorAll<HTMLButtonElement>("[data-tiptap-command]")];
  const update = () => {
    for (const button of buttons) {
      const active = commandIsActive(editor, button.dataset.tiptapCommand || "");
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  };
  const click = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-tiptap-command]");
    if (!button) return;
    event.preventDefault();
    runTiptapCommand(editor, button.dataset.tiptapCommand || "");
    update();
  };
  const preserveSelection = (event: Event) => event.preventDefault();
  toolbar.addEventListener("mousedown", preserveSelection);
  toolbar.addEventListener("click", click);
  editor.on("selectionUpdate", update);
  editor.on("transaction", update);
  update();
  return () => {
    toolbar.removeEventListener("mousedown", preserveSelection);
    toolbar.removeEventListener("click", click);
    editor.off("selectionUpdate", update);
    editor.off("transaction", update);
  };
}

async function mountMarkdown(options: MarkdownMountOptions): Promise<MountedEditor> {
  const crepe = new CrepeBuilder({
    root: options.root,
    defaultValue: options.initialMarkdown,
  })
    .addFeature(cursor)
    .addFeature(listItem)
    .addFeature(linkTooltip)
    .addFeature(blockEdit)
    .addFeature(toolbar)
    .addFeature(topBar)
    .addFeature(table)
    .addFeature(placeholder, { text: options.placeholder || "开始编写内容…", mode: "block" });
  crepe.on((listener) => {
    listener.markdownUpdated((_ctx, markdown, previousMarkdown) => {
      if (markdown !== previousMarkdown) options.onChange(markdown);
    });
  });
  const handle: MountedEditor = {
    destroy: async () => {
      mounted.delete(handle);
      await crepe.destroy();
    },
  };
  try {
    await crepe.create();
    mounted.add(handle);
    options.root.dataset.editorReady = "true";
    options.onReady?.();
    return handle;
  } catch (error) {
    options.onError?.(error);
    throw error;
  }
}

function mountRichText(options: RichTextMountOptions): MountedEditor {
  const editor = new Editor({
    element: options.root,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      TableKit.configure({ table: { resizable: true } }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
    ],
    content: options.initialMarkdown || options.initialHtml || "<p></p>",
    contentType: options.initialMarkdown ? "markdown" : "html",
    editorProps: {
      attributes: {
        class: "tiptap-document",
        spellcheck: "true",
        "aria-label": "文档正文",
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      options.onChange(activeEditor.getHTML(), activeEditor.getText({ blockSeparator: "\n\n" }));
    },
  });
  const unmountToolbar = mountToolbar(editor, options.toolbar);
  const handle: MountedEditor = {
    destroy: () => {
      mounted.delete(handle);
      unmountToolbar();
      editor.destroy();
    },
  };
  mounted.add(handle);
  options.root.dataset.editorReady = "true";
  options.onReady?.();
  return handle;
}

function destroyAll(): void {
  for (const editor of [...mounted]) void editor.destroy();
  mounted.clear();
}

declare global {
  interface Window {
    ClownfishDocumentEditors: {
      mountMarkdown: typeof mountMarkdown;
      mountRichText: typeof mountRichText;
      destroyAll: typeof destroyAll;
    };
  }
}

window.ClownfishDocumentEditors = { mountMarkdown, mountRichText, destroyAll };
