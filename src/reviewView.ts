import { ItemView, WorkspaceLeaf, MarkdownView, TFile } from "obsidian";
import { CardData, Rating } from "./models";
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
	private session: ReviewSession | null = null;
	private answerRevealed = false;
	private sourceLeaf: WorkspaceLeaf | null = null;

	constructor(leaf: WorkspaceLeaf, store: CardStore) {
		super(leaf);
		this.store = store;
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
		const progressWrap = container.createDiv({ cls: "newanki-progress" });

		const label = progressWrap.createDiv({ cls: "newanki-progress-label" });
		label.setText(
			`${session.reviewed + 1} / ${session.total}`
		);

		const barOuter = progressWrap.createDiv({ cls: "newanki-progress-bar" });
		const barInner = barOuter.createDiv({ cls: "newanki-progress-fill" });
		const pct = ((session.reviewed) / session.total) * 100;
		barInner.style.width = `${pct}%`;
	}

	private renderCard(container: HTMLElement, card: CardData): void {
		const cardEl = container.createDiv({ cls: "newanki-card" });

		const questionSection = cardEl.createDiv({ cls: "newanki-question-section" });
		questionSection.createEl("div", { text: "问题", cls: "newanki-section-label" });
		questionSection.createEl("div", { text: card.question, cls: "newanki-question-text" });

		if (this.answerRevealed) {
			const divider = cardEl.createDiv({ cls: "newanki-divider" });
			divider.createEl("hr");

			const answerSection = cardEl.createDiv({ cls: "newanki-answer-section" });
			answerSection.createEl("div", { text: "答案", cls: "newanki-section-label" });
			answerSection.createEl("div", { text: card.answer, cls: "newanki-answer-content" });
		}

		if (this.session?.isGlobal) {
			const sourceInfo = cardEl.createDiv({ cls: "newanki-source-info" });
			sourceInfo.createEl("span", {
				text: `来源: ${card.sourceFile}`,
				cls: "newanki-source-path",
			});
		}
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
		await this.store.updateCard(result.card);

		if (this.session) {
			this.session.reviewed++;
			this.session.currentIndex++;
			this.answerRevealed = false;

			this.render();
			this.scrollToCardSource();
		}
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

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}
}
