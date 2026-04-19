//复习视图组件
import { ItemView, WorkspaceLeaf, MarkdownView, TFile, MarkdownRenderer } from "obsidian";
import { CardData, Rating, State } from "./models";
import { CardStore } from "./store";
import { reviewCard, getNextIntervals } from "./sm2";

export const REVIEW_VIEW_TYPE = "newanki-review-view";

interface ReviewSession {
	cards: CardData[];
	currentIndex: number;
	total: number;
	reviewed: number;
	isGlobal: boolean;
	sourceFile: string | null;
}

export class ReviewView extends ItemView {
	private store: CardStore;
	private onCardsChanged?: () => void;
	private session: ReviewSession | null = null;
	private answerRevealed = false;
	private sourceLeaf: WorkspaceLeaf | null = null;

	constructor(leaf: WorkspaceLeaf, store: CardStore, onCardsChanged?: () => void) {
		super(leaf);
		this.store = store;
		this.onCardsChanged = onCardsChanged;
	}

	getViewType(): string {
		return REVIEW_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "NewAnki 复习";
	}

	getIcon(): string {
		return "layers";
	}

	setSourceLeaf(leaf: WorkspaceLeaf): void {
		this.sourceLeaf = leaf;
	}

	startReview(cards: CardData[], isGlobal: boolean, sourceFile: string | null): void {
		this.session = {
			cards: [...cards],
			currentIndex: 0,
			total: cards.length,
			reviewed: 0,
			isGlobal,
			sourceFile,
		};
		this.answerRevealed = false;
		this.render();
		setTimeout(() => this.scrollToCardSource(), 500);
	}

	private render(): void {
		const container = this.contentEl;
		container.empty();
		container.addClass("newanki-review-container");

		if (!this.session || this.session.cards.length === 0) {
			this.renderEmpty(container);
			return;
		}

		if (this.session.currentIndex >= this.session.cards.length) {
			this.renderComplete(container);
			return;
		}

		const card = this.session.cards[this.session.currentIndex]!;

		this.renderProgress(container);
		this.renderCard(container, card);

		if (this.answerRevealed) {
			this.renderRatingButtons(container, card);
		} else {
			this.renderShowAnswerButton(container);
		}
	}

	private renderEmpty(container: HTMLElement): void {
		const wrap = container.createDiv({ cls: "newanki-empty" });
		wrap.createEl("div", { text: "🎉", cls: "newanki-empty-icon" });
		wrap.createEl("h3", { text: "没有待复习的卡片" });
		wrap.createEl("p", { text: "当前没有到期的卡片需要复习。" });
	}

	private renderComplete(container: HTMLElement): void {
		const wrap = container.createDiv({ cls: "newanki-complete" });
		wrap.createEl("div", { text: "🎉", cls: "newanki-complete-icon" });
		wrap.createEl("h3", { text: "复习完成！" });
		wrap.createEl("p", {
			text: `本次共复习了 ${this.session!.reviewed} 张卡片。`,
		});

		const closeBtn = wrap.createEl("button", {
			text: "关闭",
			cls: "newanki-close-btn",
		});
		closeBtn.addEventListener("click", () => {
			this.leaf.detach();
		});
	}

	private renderProgress(container: HTMLElement): void {
		const session = this.session!;
		const remaining = session.cards.length - session.currentIndex;
		const progressWrap = container.createDiv({ cls: "newanki-progress" });

		const label = progressWrap.createDiv({ cls: "newanki-progress-label" });
		label.setText(
			`已完成 ${session.reviewed} / ${session.total}，剩余 ${remaining}`
		);

		const barOuter = progressWrap.createDiv({ cls: "newanki-progress-bar" });
		const barInner = barOuter.createDiv({ cls: "newanki-progress-fill" });
		const pct = (session.reviewed / session.total) * 100;
		barInner.style.width = `${pct}%`;
	}

	private renderCard(container: HTMLElement, card: CardData): void {
		const cardEl = container.createDiv({ cls: "newanki-card" });

		const questionSection = cardEl.createDiv({ cls: "newanki-question-section" });
		questionSection.createEl("div", { text: "问题", cls: "newanki-section-label" });
		this.renderEditableMarkdownSection(
			questionSection,
			card.question,
			card.sourceFile,
			"newanki-question-input",
			async (newValue) => {
				if (newValue && newValue !== card.question) {
					card.question = newValue;
					await this.store.updateCard(card);
				}
			}
		);

		if (this.answerRevealed) {
			const divider = cardEl.createDiv({ cls: "newanki-divider" });
			divider.createEl("hr");

			const answerSection = cardEl.createDiv({ cls: "newanki-answer-section" });
			answerSection.createEl("div", { text: "答案", cls: "newanki-section-label" });
			this.renderEditableMarkdownSection(
				answerSection,
				card.answer,
				card.sourceFile,
				"newanki-answer-input",
				async (newValue) => {
					if (newValue && newValue !== card.answer) {
						card.answer = newValue;
						await this.store.updateCard(card);
					}
				}
			);
		}

		if (this.session?.isGlobal) {
			const sourceInfo = cardEl.createDiv({ cls: "newanki-source-info" });
			sourceInfo.createEl("span", {
				text: `来源: ${card.sourceFile}`,
				cls: "newanki-source-path",
			});
		}

		const actions = cardEl.createDiv({ cls: "newanki-card-actions" });
		const deleteBtn = actions.createEl("button", {
			text: "删除当前卡片",
			cls: "newanki-delete-card-btn",
		});
		deleteBtn.addEventListener("click", async () => {
			await this.handleDeleteCurrentCard(card);
		});
	}

	private autoResizeTextarea(textarea: HTMLTextAreaElement): void {
		const resize = () => {
			textarea.style.height = "auto";
			textarea.style.height = textarea.scrollHeight + "px";
		};
		textarea.addEventListener("input", resize);
		setTimeout(resize, 0);
	}

	private renderEditableMarkdownSection(
		container: HTMLElement,
		value: string,
		sourcePath: string,
		inputClass: string,
		onBlurSave: (newValue: string) => Promise<void>
	): void {
		const wrap = container.createDiv({ cls: "newanki-inline-markdown" });
		const preview = wrap.createDiv({
			cls: "newanki-markdown-preview newanki-editable-preview markdown-rendered",
		});
		const input = wrap.createEl("textarea", {
			cls: `${inputClass} newanki-inline-editor`,
		});
		input.style.display = "none";

		let committedValue = value.trim();
		let isEditing = false;
		let rendering = false;
		let renderQueued = false;

		const renderPreview = async (markdown: string) => {
			if (rendering) {
				renderQueued = true;
				return;
			}
			rendering = true;
			try {
				do {
					renderQueued = false;
					preview.empty();
					if (markdown) {
						preview.removeClass("is-empty");
						await MarkdownRenderer.render(this.app, markdown, preview, sourcePath, this);
					} else {
						preview.addClass("is-empty");
						preview.createEl("span", {
							cls: "newanki-inline-placeholder",
							text: "点击这里编辑内容",
						});
					}
				} while (renderQueued);
			} catch (error) {
				preview.empty();
				preview.createEl("div", {
					cls: "newanki-preview-error",
					text: "Markdown 预览渲染失败",
				});
				console.error("NewAnki preview render failed:", error);
			} finally {
				rendering = false;
			}
		};

		const enterEditMode = () => {
			if (isEditing) return;
			isEditing = true;
			input.value = committedValue;
			input.style.display = "";
			preview.style.display = "none";
			this.autoResizeTextarea(input);
			input.focus();
			const end = input.value.length;
			input.setSelectionRange(end, end);
		};

		const exitEditMode = async (save: boolean) => {
			if (!isEditing) return;
			isEditing = false;

			if (save) {
				const nextValue = input.value.trim();
				if (nextValue !== committedValue) {
					await onBlurSave(nextValue);
					committedValue = nextValue;
				}
			} else {
				input.value = committedValue;
			}

			input.style.display = "none";
			preview.style.display = "";
			await renderPreview(committedValue);
		};

		preview.addEventListener("click", () => {
			enterEditMode();
		});

		input.addEventListener("blur", () => {
			void exitEditMode(true);
		});

		input.addEventListener("keydown", (evt) => {
			if (evt.key === "Escape") {
				evt.preventDefault();
				void exitEditMode(false);
				return;
			}
			if (evt.key === "Enter" && (evt.ctrlKey || evt.metaKey)) {
				evt.preventDefault();
				void exitEditMode(true);
			}
		});

		void renderPreview(committedValue);
	}

	private renderShowAnswerButton(container: HTMLElement): void {
		const btnWrap = container.createDiv({ cls: "newanki-show-answer-wrap" });
		const btn = btnWrap.createEl("button", {
			text: "显示答案",
			cls: "newanki-show-answer-btn",
		});
		btn.addEventListener("click", () => {
			this.answerRevealed = true;
			this.render();
		});
	}

	private renderRatingButtons(container: HTMLElement, card: CardData): void {
		const intervals = getNextIntervals(card, this.store.settings);
		const btnWrap = container.createDiv({ cls: "newanki-rating-buttons" });

		const ratingLabels: Record<number, string> = {
			[Rating.Again]: "重来",
			[Rating.Hard]: "困难",
			[Rating.Good]: "良好",
			[Rating.Easy]: "简单",
		};

		const ratingClasses: Record<number, string> = {
			[Rating.Again]: "newanki-btn-again",
			[Rating.Hard]: "newanki-btn-hard",
			[Rating.Good]: "newanki-btn-good",
			[Rating.Easy]: "newanki-btn-easy",
		};

		for (const preview of intervals) {
			const btnCol = btnWrap.createDiv({ cls: "newanki-rating-col" });
			btnCol.createEl("div", {
				text: preview.label,
				cls: "newanki-interval-label",
			});

			const btn = btnCol.createEl("button", {
				text: ratingLabels[preview.rating],
				cls: `newanki-rating-btn ${ratingClasses[preview.rating]}`,
			});

			btn.addEventListener("click", async () => {
				await this.handleRating(card, preview.rating);
			});
		}
	}

	private async handleRating(card: CardData, rating: Rating): Promise<void> {
		const result = reviewCard(card, rating, this.store.settings);
		// 根据卡片状态更新inLearningQueue
		if (result.card.state === State.Review) {
			result.card.inLearningQueue = false;
		} else {
			result.card.inLearningQueue = true;
		}
		await this.store.updateCard(result.card);
		this.onCardsChanged?.();

		if (this.session) {
			const updatedCard = result.card;
			const graduated = updatedCard.state === State.Review;

			if (graduated) {
				this.session.reviewed++;
			} else {
				this.session.cards.push(updatedCard);
			}

			this.session.currentIndex++;
			this.answerRevealed = false;

			this.render();
			this.scrollToCardSource();
		}
	}

	private async handleDeleteCurrentCard(card: CardData): Promise<void> {
		if (!this.session) return;
		if (!confirm("确认删除当前正在复习的卡片吗？")) return;

		await this.store.deleteCard(card.cardId, card.sourceFile);
		this.onCardsChanged?.();

		const before = this.session.cards.slice(0, this.session.currentIndex);
		const after = this.session.cards
			.slice(this.session.currentIndex)
			.filter((c) => c.cardId !== card.cardId);
		const nextCards = [...before, ...after];
		const removedCount = this.session.cards.length - nextCards.length;

		this.session.cards = nextCards;
		this.session.total = Math.max(0, this.session.total - removedCount);
		this.answerRevealed = false;

		this.render();
		void this.scrollToCardSource();
	}

	private async scrollToCardSource(): Promise<void> {
		if (!this.session || this.session.currentIndex >= this.session.cards.length) {
			return;
		}
		if (!this.sourceLeaf) return;

		const card = this.session.cards[this.session.currentIndex]!;
		const file = this.app.vault.getAbstractFileByPath(card.sourceFile);
		if (!(file instanceof TFile)) return;

		const currentView = this.sourceLeaf.view;
		const currentFile = currentView instanceof MarkdownView ? currentView.file : null;

		if (!currentFile || currentFile.path !== card.sourceFile) {
			await this.sourceLeaf.openFile(file);
			setTimeout(() => this.highlightCardInEditor(card), 300);
		} else {
			this.highlightCardInEditor(card);
		}
	}

	private highlightCardInEditor(card: CardData): void {
		if (!this.sourceLeaf) return;
		const view = this.sourceLeaf.view;
		if (!(view instanceof MarkdownView)) return;

		const editor = view.editor;
		const endLineText = editor.getLine(card.lineEnd) ?? "";

		editor.setSelection(
			{ line: card.lineStart, ch: 0 },
			{ line: card.lineEnd, ch: endLineText.length }
		);
		editor.scrollIntoView(
			{
				from: { line: card.lineStart, ch: 0 },
				to: { line: card.lineEnd, ch: endLineText.length },
			},
			true
		);
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("newanki-review-container");
		const wrap = this.contentEl.createDiv({ cls: "newanki-empty" });
		wrap.createEl("h3", { text: "NewAnki 复习" });
		wrap.createEl("p", { text: "请通过文件菜单或命令面板启动复习。" });
	}

	private async setCardInLearningQueue(card: CardData, inQueue: boolean): Promise<void> {
		if (card.inLearningQueue === inQueue) {
			return;
		}
		card.inLearningQueue = inQueue;
		await this.store.updateCard(card);
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}
}
