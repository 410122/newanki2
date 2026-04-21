//卡片预览模态框
import { App, Component, MarkdownRenderer, Modal, Notice } from "obsidian";
import { CardData, Rating, State } from "./models";
import { CardStore } from "./store";
import { timeService } from "./timeService";

type PreviewScope = "global" | "local";

interface CardPreviewModalOptions {
	store: CardStore;
	scope: PreviewScope;
	filePath?: string;
	onDataChanged?: () => void;
}

export class CardPreviewModal extends Modal {
	private store: CardStore;
	private previewScope: PreviewScope;
	private filePath: string | null;
	private onDataChanged?: () => void;
	private markdownComponent = new Component();

	private showCreateForm = false;
	private createQuestion = "";
	private createAnswer = "";
	private createSourcePath = "";
	private selectedGlobalFile: string | null = null;

	constructor(app: App, options: CardPreviewModalOptions) {
		super(app);
		this.store = options.store;
		this.previewScope = options.scope;
		this.filePath = options.filePath ?? null;
		this.onDataChanged = options.onDataChanged;
	}

	onOpen(): void {
		this.markdownComponent.load();
		this.modalEl.addClass("newanki-card-preview-modal");
		this.render();
	}

	onClose(): void {
		this.markdownComponent.unload();
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		const totalCards = this.store.getAllCards().length;
		const cards = this.getCards();
		const subtitle =
			this.previewScope === "global"
				? `当前文件 ${cards.length} 张 / 全部 ${totalCards} 张`
				: `共 ${cards.length} 张卡片`;

		const header = contentEl.createDiv({ cls: "newanki-card-preview-header" });
		header.createEl("h3", { text: this.getTitle() });
		header.createEl("div", {
			cls: "newanki-card-preview-subtitle",
			text: subtitle,
		});

		const toolbar = contentEl.createDiv({ cls: "newanki-card-preview-toolbar" });
		if (this.previewScope === "local") {
			const resetBtn = toolbar.createEl("button", {
				text: "重置复习进度",
				cls: "mod-warning",
			});
			resetBtn.addEventListener("click", async () => {
				const filePath = this.filePath ?? "";
				if (!filePath) {
					new Notice("当前文件路径无效");
					return;
				}
				if (!confirm(`确认重置「${filePath}」下所有卡片的复习进度吗？`)) {
					return;
				}

				const count = await this.store.resetReviewProgressForFile(filePath);
				if (count <= 0) {
					new Notice("当前文件没有可重置的卡片");
					return;
				}

				this.notifyDataChanged();
				new Notice(`已重置 ${count} 张卡片的复习进度`);
				this.render();
			});
		}

		const addBtn = toolbar.createEl("button", {
			text: this.showCreateForm ? "收起添加" : "添加卡片",
			cls: "mod-cta",
		});
		addBtn.addEventListener("click", () => {
			this.showCreateForm = !this.showCreateForm;
			this.render();
		});

		if (this.showCreateForm) {
			this.renderCreateForm(contentEl);
		}

		if (this.previewScope === "global") {
			this.renderGlobalLayout(contentEl, cards);
			return;
		}
		this.renderCardList(contentEl, cards);
	}

	private renderGlobalLayout(container: HTMLElement, cards: CardData[]): void {
		const layout = container.createDiv({ cls: "newanki-global-preview-layout" });
		const sidebar = layout.createDiv({ cls: "newanki-global-file-sidebar" });
		const content = layout.createDiv({ cls: "newanki-global-card-content" });

		const filePaths = this.getGlobalFilePaths();
		this.ensureGlobalSelection(filePaths);

		sidebar.createEl("div", {
			cls: "newanki-global-file-title",
			text: "Markdown 文件",
		});

		const fileList = sidebar.createDiv({ cls: "newanki-global-file-list" });
		if (filePaths.length === 0) {
			fileList.createEl("div", {
				cls: "newanki-card-empty",
				text: "暂无 Markdown 文件",
			});
			content.createEl("div", {
				cls: "newanki-card-empty",
				text: "暂无卡片，点击上方“添加卡片”创建。",
			});
			return;
		}

		for (const path of filePaths) {
			const cardCount = this.store.getCardCount(path);
			const item = fileList.createEl("button", {
				cls: "newanki-global-file-item",
				text: `${path} (${cardCount})`,
			});
			if (path === this.selectedGlobalFile) {
				item.addClass("is-active");
			}
			item.addEventListener("click", () => {
				this.selectedGlobalFile = path;
				this.render();
			});
		}

		this.renderCardList(content, cards);
	}

	private renderCardList(container: HTMLElement, cards: CardData[]): void {
		const list = container.createDiv({ cls: "newanki-card-list" });
		if (cards.length === 0) {
			list.createEl("div", {
				cls: "newanki-card-empty",
				text:
					this.previewScope === "global"
						? "当前文件暂无卡片。"
						: "暂无卡片，点击上方“添加卡片”创建。",
			});
			return;
		}

		for (const card of cards) {
			this.renderCardItem(list, card);
		}
	}

	private renderCreateForm(container: HTMLElement): void {
		const form = container.createDiv({ cls: "newanki-create-card-form" });
		form.createEl("div", {
			cls: "newanki-form-title",
			text: "新建卡片",
		});

		form.createEl("div", { cls: "newanki-form-label", text: "问题" });
		const questionInput = form.createEl("textarea", {
			cls: "newanki-form-input",
			attr: { placeholder: "请输入问题..." },
		});
		questionInput.value = this.createQuestion;
		this.autoResizeTextarea(questionInput);
		questionInput.addEventListener("input", () => {
			this.createQuestion = questionInput.value;
		});

		form.createEl("div", { cls: "newanki-form-label", text: "答案（支持 Markdown）" });
		const answerInput = form.createEl("textarea", {
			cls: "newanki-form-input",
			attr: { placeholder: "请输入答案..." },
		});
		answerInput.value = this.createAnswer;
		this.autoResizeTextarea(answerInput);
		answerInput.addEventListener("input", () => {
			this.createAnswer = answerInput.value;
		});

		let sourcePath = this.resolveCreateSourcePath();
		if (this.previewScope === "global") {
			form.createEl("div", { cls: "newanki-form-label", text: "来源文件" });
			const select = form.createEl("select", {
				cls: "newanki-form-select",
			});
			const paths = this.getAllMarkdownPaths();
			for (const path of paths) {
				select.createEl("option", { text: path, value: path });
			}
			if (paths.length > 0) {
				if (!this.createSourcePath) {
					this.createSourcePath = this.selectedGlobalFile ?? paths[0]!;
				}
				select.value = this.createSourcePath;
				sourcePath = this.createSourcePath;
			}
			select.addEventListener("change", () => {
				this.createSourcePath = select.value;
			});
		} else if (sourcePath) {
			form.createEl("div", { cls: "newanki-form-label", text: "来源文件" });
			form.createEl("div", {
				cls: "newanki-form-readonly",
				text: sourcePath,
			});
		}

		const actions = form.createDiv({ cls: "newanki-form-actions" });
		const confirmBtn = actions.createEl("button", { text: "创建", cls: "mod-cta" });
		confirmBtn.addEventListener("click", async () => {
			const question = this.createQuestion.trim();
			const answer = this.createAnswer.trim();
			sourcePath = this.resolveCreateSourcePath();

			if (!question || !answer) {
				new Notice("问题和答案不能为空");
				return;
			}
			if (!sourcePath) {
				new Notice("请选择来源文件");
				return;
			}

			const card: CardData = {
				cardId: this.generateId(),
				question,
				answer,
				sourceFile: sourcePath,
				lineStart: 0,
				lineEnd: 0,
				state: State.New,
				step: null,
				ease: null,
				due: timeService.nowISO(),
				currentInterval: null,
				createdAt: timeService.nowISO(),
			};

			await this.store.addCard(card);
			if (this.previewScope === "global") {
				this.selectedGlobalFile = card.sourceFile;
			}
			this.notifyDataChanged();
			new Notice("卡片已创建");

			this.createQuestion = "";
			this.createAnswer = "";
			this.showCreateForm = false;
			this.render();
		});

		const cancelBtn = actions.createEl("button", { text: "取消" });
		cancelBtn.addEventListener("click", () => {
			this.showCreateForm = false;
			this.render();
		});
	}

	private renderCardItem(container: HTMLElement, card: CardData): void {
		const item = container.createDiv({ cls: "newanki-card-item" });

		const meta = item.createDiv({ cls: "newanki-card-item-meta" });
		meta.createEl("div", {
			cls: "newanki-card-source",
			text: card.sourceFile,
		});
		meta.createEl("div", {
			cls: "newanki-card-due",
			text: `到期: ${this.formatDateTime(card.due)}`,
		});

		item.createEl("div", { cls: "newanki-form-label", text: "问题" });
		const questionInput = item.createEl("textarea", {
			cls: "newanki-form-input",
		});
		questionInput.value = card.question;
		this.autoResizeTextarea(questionInput);

		item.createEl("div", { cls: "newanki-form-label", text: "答案" });
		const answerInput = item.createEl("textarea", {
			cls: "newanki-form-input",
		});
		answerInput.value = card.answer;
		this.autoResizeTextarea(answerInput);

		let previewVisible = false;
		const previewWrap = item.createDiv({
			cls: "newanki-card-item-preview",
		});
		previewWrap.style.display = "none";

		const renderPreview = async () => {
			previewWrap.empty();
			const questionTitle = previewWrap.createDiv({ cls: "newanki-preview-block-title" });
			questionTitle.setText("问题预览");
			const questionPreview = previewWrap.createDiv({ cls: "markdown-rendered" });
			await this.renderMarkdown(questionInput.value.trim(), questionPreview, card.sourceFile);

			const answerTitle = previewWrap.createDiv({ cls: "newanki-preview-block-title" });
			answerTitle.setText("答案预览");
			const answerPreview = previewWrap.createDiv({ cls: "markdown-rendered" });
			await this.renderMarkdown(answerInput.value.trim(), answerPreview, card.sourceFile);
		};

		questionInput.addEventListener("input", () => {
			this.autoResizeTextarea(questionInput);
			if (previewVisible) {
				void renderPreview();
			}
		});
		answerInput.addEventListener("input", () => {
			this.autoResizeTextarea(answerInput);
			if (previewVisible) {
				void renderPreview();
			}
		});

		const actions = item.createDiv({ cls: "newanki-card-item-actions" });
		const previewBtn = actions.createEl("button", { text: "预览" });
		previewBtn.addEventListener("click", () => {
			previewVisible = !previewVisible;
			previewWrap.style.display = previewVisible ? "" : "none";
			previewBtn.setText(previewVisible ? "隐藏预览" : "预览");
			if (previewVisible) {
				void renderPreview();
			}
		});

		const saveBtn = actions.createEl("button", { text: "保存", cls: "mod-cta" });
		saveBtn.addEventListener("click", async () => {
			const question = questionInput.value.trim();
			const answer = answerInput.value.trim();
			if (!question || !answer) {
				new Notice("问题和答案不能为空");
				return;
			}

			const updated: CardData = {
				...card,
				question,
				answer,
			};
			await this.store.updateCard(updated);
			card.question = question;
			card.answer = answer;

			this.notifyDataChanged();
			new Notice("卡片已保存");

			if (previewVisible) {
				void renderPreview();
			}
		});

		const deleteBtn = actions.createEl("button", {
			text: "删除",
			cls: "mod-warning",
		});
		deleteBtn.addEventListener("click", async () => {
			if (!confirm("确认删除这张卡片吗？")) return;
			await this.store.deleteCard(card.cardId, card.sourceFile);
			this.notifyDataChanged();
			new Notice("卡片已删除");
			this.render();
		});

		// 查看日志按钮
		let logVisible = false;
		const logWrap = item.createDiv({ cls: "newanki-card-log-wrap" });
		logWrap.style.display = "none";

		const logBtn = actions.createEl("button", { text: "查看日志" });
		logBtn.addEventListener("click", () => {
			logVisible = !logVisible;
			logWrap.style.display = logVisible ? "" : "none";
			logBtn.setText(logVisible ? "隐藏日志" : "查看日志");
			if (logVisible) {
				this.renderLogTable(logWrap, card.cardId);
			}
		});
	}

	private ratingLabel(rating: Rating): string {
		switch (rating) {
			case Rating.Again: return "重来";
			case Rating.Hard: return "困难";
			case Rating.Good: return "良好";
			case Rating.Easy: return "简单";
			default: return String(rating);
		}
	}

	private renderLogTable(container: HTMLElement, cardId: string): void {
		container.empty();
		const logs = this.store.getReviewLogs(cardId);

		if (logs.length === 0) {
			container.createEl("div", {
				cls: "newanki-card-empty",
				text: "暂无复习记录",
			});
			return;
		}

		const table = container.createEl("table", { cls: "newanki-log-table" });
		const thead = table.createEl("thead");
		const headerRow = thead.createEl("tr");
		headerRow.createEl("th", { text: "复习时间" });
		headerRow.createEl("th", { text: "操作" });
		headerRow.createEl("th", { text: "到期时间" });

		const tbody = table.createEl("tbody");
		for (const log of logs) {
			const row = tbody.createEl("tr");
			row.createEl("td", { text: this.formatDateTime(log.reviewDatetime) });
			row.createEl("td", { text: this.ratingLabel(log.rating) });
			row.createEl("td", { text: this.formatDateTime(log.newDue) });
		}
	}

	private getCards(): CardData[] {
		let cards: CardData[] = [];
		if (this.previewScope === "global") {
			const filePaths = this.getGlobalFilePaths();
			this.ensureGlobalSelection(filePaths);
			cards = this.selectedGlobalFile
				? this.store.getCardsForFile(this.selectedGlobalFile)
				: [];
		} else {
			cards = this.store.getCardsForFile(this.filePath ?? "");
		}

		return [...cards].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	private getTitle(): string {
		if (this.previewScope === "global") {
			return "全局卡片预览器";
		}
		return `局部卡片预览器 - ${this.filePath ?? "当前文件"}`;
	}

	private resolveCreateSourcePath(): string {
		if (this.previewScope === "local") {
			return this.filePath ?? "";
		}
		return this.createSourcePath;
	}

	private getGlobalFilePaths(): string[] {
		return this.app.vault
			.getMarkdownFiles()
			.map((f) => f.path)
			.sort((a, b) => a.localeCompare(b, "zh-CN"));
	}

	private ensureGlobalSelection(filePaths: string[]): void {
		if (this.previewScope !== "global") return;
		if (!this.selectedGlobalFile || !filePaths.includes(this.selectedGlobalFile)) {
			this.selectedGlobalFile = filePaths[0] ?? null;
		}
	}

	private getAllMarkdownPaths(): string[] {
		return this.app.vault
			.getMarkdownFiles()
			.map((f) => f.path)
			.sort((a, b) => a.localeCompare(b, "zh-CN"));
	}

	private autoResizeTextarea(textarea: HTMLTextAreaElement): void {
		textarea.style.height = "auto";
		textarea.style.height = `${textarea.scrollHeight}px`;
	}

	private async renderMarkdown(markdown: string, container: HTMLElement, sourcePath: string): Promise<void> {
		if (!markdown) {
			container.createEl("div", {
				cls: "newanki-preview-empty",
				text: "（空）",
			});
			return;
		}
		try {
			await MarkdownRenderer.render(
				this.app,
				markdown,
				container,
				sourcePath,
				this.markdownComponent
			);
		} catch (error) {
			container.empty();
			container.createEl("div", {
				cls: "newanki-preview-error",
				text: "Markdown 渲染失败",
			});
			console.error("NewAnki card preview render failed:", error);
		}
	}

	private formatDateTime(iso: string): string {
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return iso;
		return date.toLocaleString();
	}

	private notifyDataChanged(): void {
		this.onDataChanged?.();
	}

	private generateId(): string {
		return timeService.nowTimestamp().toString(36) + Math.random().toString(36).substring(2, 9);
	}
}
