//复习视图组件
import { ItemView, WorkspaceLeaf, MarkdownView, TFile, MarkdownRenderer, Modal, App, Setting } from "obsidian";
import { CardData, Rating, ReviewLogData, State, OcclusionRect } from "./models";
import { CardStore } from "./store";
import { reviewCard, getNextIntervals } from "./sm2";
import { timeService } from "./timeService";

class CustomDaysModal extends Modal {
	private days: number | null = null;
	private onSubmit: (days: number) => void;

	constructor(app: App, onSubmit: (days: number) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "自定义到期天数" });

		new Setting(contentEl)
			.setName("天数")
			.setDesc("指定多少天后该卡片到期")
			.addText((text) => {
				text.setPlaceholder("例如: 5");
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text.inputEl.addEventListener("input", () => {
					const val = parseInt(text.getValue());
					this.days = isNaN(val) || val < 1 ? null : val;
				});
				text.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter" && this.days !== null) {
						this.onSubmit(this.days);
						this.close();
					}
				});
				setTimeout(() => text.inputEl.focus(), 50);
			});

		new Setting(contentEl)
			.addButton((btn) => {
				btn.setButtonText("确定")
					.setCta()
					.onClick(() => {
						if (this.days !== null) {
							this.onSubmit(this.days);
							this.close();
						}
					});
			})
			.addButton((btn) => {
				btn.setButtonText("取消")
					.onClick(() => this.close());
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

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
	private blurredElements: HTMLElement[] = [];

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

	setSourceLeaf(leaf: WorkspaceLeaf | null): void {
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

		if (card.cardType === "image-occlusion" && card.imagePath) {
			this.renderImageOcclusionCard(cardEl, card);
		} else {
			this.renderNormalCard(cardEl, card);
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

	private renderNormalCard(cardEl: HTMLElement, card: CardData): void {
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
	}

	private renderImageOcclusionCard(cardEl: HTMLElement, card: CardData): void {
		const imagePath = card.imagePath!;
		const occlusion = card.occlusion!;
		const imageFile = this.app.vault.getAbstractFileByPath(imagePath);

		if (!(imageFile instanceof TFile)) {
			cardEl.createEl("div", {
				cls: "newanki-occlusion-error",
				text: `找不到图片: ${imagePath}`,
			});
			return;
		}

		const resourcePath = this.app.vault.getResourcePath(imageFile);

		const questionSection = cardEl.createDiv({ cls: "newanki-question-section" });
		questionSection.createEl("div", { text: "问题", cls: "newanki-section-label" });

		const imgContainer = questionSection.createDiv({
			cls: "newanki-occlusion-img-container",
		});
		const img = imgContainer.createEl("img", {
			cls: "newanki-occlusion-img",
		});
		img.src = resourcePath;

		img.onload = () => {
			const displayW = img.clientWidth;
			const displayH = img.clientHeight;

			const canvas = imgContainer.createEl("canvas", {
				cls: "newanki-occlusion-overlay",
			});
			canvas.width = displayW;
			canvas.height = displayH;

			const ctx = canvas.getContext("2d");
			if (!ctx || !occlusion) return;

			if (!this.answerRevealed) {
				const x = (occlusion.x / 100) * displayW;
				const y = (occlusion.y / 100) * displayH;
				const w = (occlusion.width / 100) * displayW;
				const h = (occlusion.height / 100) * displayH;

				ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
				ctx.fillRect(x, y, w, h);
				ctx.strokeStyle = "rgba(255, 0, 0, 0.9)";
				ctx.lineWidth = 2;
				ctx.strokeRect(x, y, w, h);
			}
		};

		if (this.session?.isGlobal) {
			const sourceInfo = cardEl.createDiv({ cls: "newanki-source-info" });
			sourceInfo.createEl("span", {
				text: `来源: ${card.sourceFile}`,
				cls: "newanki-source-path",
			});
		}
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
			this.applyBlurEffect(false); // 移除模糊效果
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

		// 自定义天数按钮
		const customWrap = container.createDiv({ cls: "newanki-custom-days-wrap" });
		const customBtn = customWrap.createEl("button", {
			text: "自定义天数",
			cls: "newanki-rating-btn newanki-btn-custom-days",
		});
		customBtn.addEventListener("click", () => {
			new CustomDaysModal(this.app, async (days: number) => {
				await this.handleCustomDays(card, days);
			}).open();
		});
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

		// 记录复习日志
		const log: ReviewLogData = {
			cardId: card.cardId,
			rating,
			reviewDatetime: result.reviewDatetime,
			prevState: card.state,
			prevEase: card.ease,
			prevInterval: card.currentInterval,
			newDue: result.card.due,
		};
		await this.store.addReviewLog(log);

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
			this.applyBlurEffect(true); // 应用模糊效果到新卡片

			this.render();
			this.scrollToCardSource();
		}
	}

	private async handleCustomDays(card: CardData, days: number): Promise<void> {
		const now = timeService.nowISO();
		const prevState = card.state;
		const prevEase = card.ease;
		const prevInterval = card.currentInterval;

		const dueDate = new Date(now);
		dueDate.setTime(dueDate.getTime() + days * 24 * 60 * 60 * 1000);

		card.due = dueDate.toISOString();
		card.currentInterval = days;
		card.inLearningQueue = false;

		// 非 Review 状态的卡片，直接毕业到 Review
		if (card.state !== State.Review) {
			card.state = State.Review;
			card.step = null;
			if (card.ease === null) {
				card.ease = this.store.settings.startingEase;
			}
		}

		await this.store.updateCard(card);

		// 记录复习日志（自定义天数用 Good 评级记录）
		const log: ReviewLogData = {
			cardId: card.cardId,
			rating: Rating.Good,
			reviewDatetime: now,
			prevState,
			prevEase,
			prevInterval,
			newDue: card.due,
		};
		await this.store.addReviewLog(log);

		this.onCardsChanged?.();

		if (this.session) {
			this.session.reviewed++;
			this.session.currentIndex++;
			this.answerRevealed = false;
			this.applyBlurEffect(true);
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
			setTimeout(() => {
				this.highlightCardInEditor(card);
				this.applyBlurEffect(!this.answerRevealed); // 根据状态应用模糊
			}, 300);
		} else {
			this.highlightCardInEditor(card);
			this.applyBlurEffect(!this.answerRevealed); // 根据状态应用模糊
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

	/**
	 * 应用或移除模糊效果
	 * @param blur true: 应用模糊效果, false: 移除模糊效果
	 */
	private applyBlurEffect(blur: boolean): void {
		console.log(`applyBlurEffect called: blur=${blur}, answerRevealed=${this.answerRevealed}`);

		// 清理之前的模糊效果
		this.clearBlurEffect();

		if (!this.sourceLeaf || !this.session || this.session.currentIndex >= this.session.cards.length) {
			console.log('applyBlurEffect: missing sourceLeaf or session');
			return;
		}

		const view = this.sourceLeaf.view;
		if (!(view instanceof MarkdownView)) {
			console.log('applyBlurEffect: view is not MarkdownView');
			return;
		}

		const card = this.session.cards[this.session.currentIndex]!;
		console.log(`applyBlurEffect: card lines ${card.lineStart}-${card.lineEnd}`);

		// 获取编辑器DOM元素
		const editorEl = this.getEditorElement(view);
		if (!editorEl) {
			console.log('applyBlurEffect: could not get editor element');
			return;
		}
		console.log('applyBlurEffect: editor element found', editorEl);

		// 查找对应行的DOM元素
		const lineElements = this.findLineElements(editorEl, card.lineStart, card.lineEnd);
		console.log(`applyBlurEffect: found ${lineElements.length} line elements`);

		// 应用模糊效果
		lineElements.forEach(el => {
			if (blur) {
				el.classList.add('newanki-blurred-text');
				this.blurredElements.push(el);
				console.log('applyBlurEffect: added blur to element', el);
			} else {
				el.classList.remove('newanki-blurred-text');
				console.log('applyBlurEffect: removed blur from element', el);
			}
		});
	}

	/**
	 * 清理所有模糊效果
	 */
	private clearBlurEffect(): void {
		this.blurredElements.forEach(el => {
			el.classList.remove('newanki-blurred-text');
		});
		this.blurredElements = [];
	}

	/**
	 * 获取编辑器DOM元素
	 */
	private getEditorElement(view: MarkdownView): HTMLElement | null {
		// 方法1: 通过cm属性访问CodeMirror实例
		const editor = view.editor;
		if ((editor as any).cm) {
			return (editor as any).cm.dom;
		}

		// 方法2: 通过CSS选择器查找编辑器容器
		const container = view.containerEl;
		return container.querySelector('.cm-editor') as HTMLElement;
	}

	/**
	 * 根据行号查找DOM元素
	 */
	private findLineElements(editorEl: HTMLElement, startLine: number, endLine: number): HTMLElement[] {
		const lineElements: HTMLElement[] = [];

		console.log(`findLineElements: looking for lines ${startLine}-${endLine} in editorEl`, editorEl);

		// CodeMirror 6 中行元素通常有 data-line 属性
		for (let line = startLine; line <= endLine; line++) {
			const selector = `[data-line="${line}"]`;
			const elements = editorEl.querySelectorAll<HTMLElement>(selector);
			console.log(`findLineElements: selector "${selector}" found ${elements.length} elements`);
			elements.forEach(el => lineElements.push(el));
		}

		// 如果上述方法失败，尝试备用选择器
		if (lineElements.length === 0) {
			console.warn('无法通过data-line找到行元素，尝试备用选择器');
			// 备用：通过.cm-line类选择所有行，然后根据行号筛选
			const allLines = editorEl.querySelectorAll<HTMLElement>('.cm-line');
			console.log(`findLineElements: found ${allLines.length} .cm-line elements`);

			// 尝试通过行号映射：假设.cm-line元素按顺序对应行号
			// 注意：这种方法不可靠，但作为备用方案
			for (let i = 0; i < allLines.length; i++) {
				const lineNo = i; // 从0开始的行号
				if (lineNo >= startLine && lineNo <= endLine) {
					lineElements.push(allLines[i]!);
				}
			}
			console.log(`findLineElements: after filtering, ${lineElements.length} elements match line range`);
		}

		return lineElements;
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
		this.clearBlurEffect();
		this.contentEl.empty();
	}
}
