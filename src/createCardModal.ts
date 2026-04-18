//制卡前端模态框
import { App, Modal, Setting } from "obsidian";
import { CardData, State } from "./models";

export class CreateCardModal extends Modal {
	private answer: string;
	private sourceFile: string;
	private lineStart: number;
	private lineEnd: number;
	private onSubmit: (card: CardData) => void;
	private question = "";

	constructor(
		app: App,
		answer: string,
		sourceFile: string,
		lineStart: number,
		lineEnd: number,
		onSubmit: (card: CardData) => void
	) {
		super(app);
		this.answer = answer;
		this.sourceFile = sourceFile;
		this.lineStart = lineStart;
		this.lineEnd = lineEnd;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;

		contentEl.createEl("h3", { text: "制作卡片" });

		const answerPreview = contentEl.createDiv({ cls: "newanki-answer-preview" });
		answerPreview.createEl("div", {
			text: "答案（选中文本）：",
			cls: "newanki-label",
		});
		answerPreview.createEl("div", {
			text: this.answer,
			cls: "newanki-answer-text",
		});

		new Setting(contentEl).setName("问题").addTextArea((text) => {
			text.setPlaceholder("请输入问题...");
			text.inputEl.rows = 3;
			text.inputEl.style.width = "100%";
			text.onChange((value) => {
				this.question = value;
			});
		});

		const btnContainer = contentEl.createDiv({ cls: "newanki-modal-buttons" });

		const confirmBtn = btnContainer.createEl("button", {
			text: "确认",
			cls: "mod-cta",
		});
		confirmBtn.addEventListener("click", () => {
			if (!this.question.trim()) {
				return;
			}
			const card: CardData = {
				cardId: this.generateId(),
				question: this.question.trim(),
				answer: this.answer,
				sourceFile: this.sourceFile,
				lineStart: this.lineStart,
				lineEnd: this.lineEnd,
				state: State.New,
				step: null,
				ease: null,
				due: new Date().toISOString(),
				currentInterval: null,
				createdAt: new Date().toISOString(),
			};
			this.onSubmit(card);
			this.close();
		});

		const cancelBtn = btnContainer.createEl("button", { text: "取消" });
		cancelBtn.addEventListener("click", () => {
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private generateId(): string {
		return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
	}
}
