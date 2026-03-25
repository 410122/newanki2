import { Editor, MarkdownView, Notice, Plugin, TFile, TAbstractFile, WorkspaceLeaf } from "obsidian";
import { CardStore } from "./store";
import { CreateCardModal } from "./createCardModal";
import { ReviewView, REVIEW_VIEW_TYPE } from "./reviewView";
import { NewAnkiSettingTab } from "./settings";

export default class NewAnkiPlugin extends Plugin {
	store: CardStore;

	async onload(): Promise<void> {
		this.store = new CardStore(this);
		await this.store.load();

		this.registerView(REVIEW_VIEW_TYPE, (leaf) => new ReviewView(leaf, this.store));

		this.registerEditorContextMenu();
		this.registerFileMenu();
		this.registerCommands();
		this.registerFileEvents();

		this.addRibbonIcon("layers", "NewAnki 全局复习", () => {
			this.startGlobalReview();
		});

		this.addSettingTab(new NewAnkiSettingTab(this.app, this));

		this.statusBarEl = this.addStatusBarItem();
		this.updateStatusBar();
	}

	onunload(): void {
		this.app.workspace.detachLeavesOfType(REVIEW_VIEW_TYPE);
	}

	private registerEditorContextMenu(): void {
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, view) => {
				const selection = editor.getSelection();
				if (!selection) return;

				menu.addItem((item) => {
					item.setTitle("制作卡片")
						.setIcon("plus-circle")
						.onClick(() => {
							const file = view.file;
							if (!file) return;

							const cursor = editor.getCursor("from");
							const cursorTo = editor.getCursor("to");

							new CreateCardModal(
								this.app,
								selection,
								file.path,
								cursor.line,
								cursorTo.line,
								async (card) => {
									await this.store.addCard(card);
									new Notice("卡片已创建！");
									this.updateStatusBar();
								}
							).open();
						});
				});
			})
		);
	}

	private registerFileMenu(): void {
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;

				const cardCount = this.store.getCardCount(file.path);
				const dueCount = this.store.getDueCardCount(file.path);

				if (cardCount > 0) {
					menu.addItem((item) => {
						item.setTitle(`复习卡片 (${dueCount}/${cardCount} 到期)`)
							.setIcon("layers")
							.onClick(() => {
								this.startFileReview(file.path);
							});
					});
				}
			})
		);
	}

	private registerCommands(): void {
		this.addCommand({
			id: "create-card",
			name: "制作卡片",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const selection = editor.getSelection();
				if (!selection) {
					new Notice("请先选中文本");
					return;
				}
				const file = view.file;
				if (!file) return;

				const cursor = editor.getCursor("from");
				const cursorTo = editor.getCursor("to");

				new CreateCardModal(
					this.app,
					selection,
					file.path,
					cursor.line,
					cursorTo.line,
					async (card) => {
						await this.store.addCard(card);
						new Notice("卡片已创建！");
						this.updateStatusBar();
					}
				).open();
			},
		});

		this.addCommand({
			id: "review-current-file",
			name: "复习当前文件的卡片",
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view?.file) return false;

				const dueCount = this.store.getDueCardCount(view.file.path);
				if (dueCount === 0) return false;

				if (!checking) {
					this.startFileReview(view.file.path);
				}
				return true;
			},
		});

		this.addCommand({
			id: "review-global-deck",
			name: "全局复习",
			callback: () => {
				this.startGlobalReview();
			},
		});
	}

	private registerFileEvents(): void {
		this.registerEvent(
			this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
				if (file instanceof TFile && file.extension === "md") {
					this.store.handleFileRename(oldPath, file.path);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("delete", (file: TAbstractFile) => {
				if (file instanceof TFile && file.extension === "md") {
					this.store.handleFileDelete(file.path);
				}
			})
		);
	}

	private async startFileReview(filePath: string): Promise<void> {
		const dueCards = this.store.getDueCardsForFile(filePath);
		if (dueCards.length === 0) {
			new Notice("当前文件没有到期的卡片。");
			return;
		}

		const { reviewLeaf, sourceLeaf } = await this.createSplitLayout();

		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			await sourceLeaf.openFile(file);
		}

		const reviewView = reviewLeaf.view as ReviewView;
		reviewView.setSourceLeaf(sourceLeaf);
		reviewView.startReview(dueCards, false, filePath);
	}

	private async startGlobalReview(): Promise<void> {
		const dueCards = this.store.getAllDueCards();
		if (dueCards.length === 0) {
			new Notice("没有到期的卡片需要复习。");
			return;
		}

		const { reviewLeaf, sourceLeaf } = await this.createSplitLayout();

		const firstCard = dueCards[0]!;
		const file = this.app.vault.getAbstractFileByPath(firstCard.sourceFile);
		if (file instanceof TFile) {
			await sourceLeaf.openFile(file);
		}

		const reviewView = reviewLeaf.view as ReviewView;
		reviewView.setSourceLeaf(sourceLeaf);
		reviewView.startReview(dueCards, true, null);
	}

	private async createSplitLayout(): Promise<{
		reviewLeaf: WorkspaceLeaf;
		sourceLeaf: WorkspaceLeaf;
	}> {
		this.app.workspace.detachLeavesOfType(REVIEW_VIEW_TYPE);

		const activeLeaf = this.app.workspace.getLeaf(true);
		await activeLeaf.setViewState({ type: REVIEW_VIEW_TYPE, active: true });

		const sourceLeaf = this.app.workspace.createLeafBySplit(activeLeaf, "vertical");

		this.app.workspace.setActiveLeaf(activeLeaf, { focus: true });

		return { reviewLeaf: activeLeaf, sourceLeaf };
	}

	private statusBarEl: HTMLElement | null = null;

	private updateStatusBar(): void {
		const total = this.store.getTotalDueCount();
		if (this.statusBarEl) {
			if (total > 0) {
				this.statusBarEl.setText(`NewAnki: ${total} 张待复习`);
			} else {
				this.statusBarEl.setText("");
			}
		}
	}
}
