import { Editor, MarkdownView, Menu, Notice, Plugin, TFile, TFolder, TAbstractFile, WorkspaceLeaf } from "obsidian";
import { CardStore } from "./store";
import { CreateCardModal } from "./createCardModal";
import { CardPreviewModal } from "./cardPreviewModal";
import { ReviewView, REVIEW_VIEW_TYPE } from "./reviewView";
import { ImageOcclusionModal } from "./imageOcclusionModal";
import { NewAnkiSettingTab } from "./settings";
import { CardData } from "./models";

export default class NewAnkiPlugin extends Plugin {
	store: CardStore;
	private globalReviewRibbonEl: HTMLElement | null = null;
	private globalReviewBadgeEl: HTMLElement | null = null;

	async onload(): Promise<void> {
		this.store = new CardStore(this);
		await this.store.load();

		this.registerView(
			REVIEW_VIEW_TYPE,
			(leaf) => new ReviewView(leaf, this.store, () => this.handleCardsChanged())
		);

		this.registerEditorContextMenu();
		this.registerFileMenu();
		this.registerImageContextMenu();
		this.registerCommands();
		this.registerFileEvents();
		this.registerReviewAction();

			const globalCounts = this.store.getTotalCardCountsByCategory();
			const globalTitle = "NewAnki 全局复习 (" + globalCounts.new + "/" + globalCounts.learning + "/" + globalCounts.review + ")";
		this.globalReviewRibbonEl = this.addRibbonIcon("layers", globalTitle, () => {
			this.startGlobalReview();
		});
		this.globalReviewRibbonEl.addClass("newanki-global-review-ribbon");
		this.addRibbonIcon("list", "NewAnki 全局卡片预览器", () => {
			this.openGlobalCardPreview();
		});

		this.addSettingTab(new NewAnkiSettingTab(this.app, this));

		this.statusBarEl = this.addStatusBarItem();
		this.updateStatusBar();
		this.updateGlobalReviewRibbonBadge();
		this.registerInterval(
			window.setInterval(() => {
				this.updateStatusBar();
				this.updateGlobalReviewRibbonBadge();
			}, 30000)
		);
	}

	onunload(): void {
		this.app.workspace.detachLeavesOfType(REVIEW_VIEW_TYPE);
		this.clearReviewAction();
	}

	private handleCardsChanged(): void {
		this.updateStatusBar();
		this.updateReviewAction();
		this.updateGlobalReviewRibbonBadge();
	}

	//建卡入口
	private registerEditorContextMenu(): void {
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, view) => {
				const selection = editor.getSelection();
				if (!selection) return;

				menu.addItem((item) => {  //右键菜单添加功能
					item.setTitle("制作卡片")
						.setIcon("plus-circle")
						.onClick(() => {
							const file = view.file;
							if (!file) return;

							const cursor = editor.getCursor("from");
							const cursorTo = editor.getCursor("to");

							new CreateCardModal(  //创建卡片模态框
								this.app,
								selection,
								file.path,
								cursor.line,
								cursorTo.line,
							async (card) => {
								await this.store.addCard(card);
								new Notice("卡片已创建！");
								this.handleCardsChanged();
							}
						).open();
					});
			});
		})
	);
	}

	//复习入口
	private registerFileMenu(): void {
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				// 文件夹右键菜单
				if (file instanceof TFolder) {
					const folderCards = this.store.getCardsForFolder(file.path);
					if (folderCards.length > 0) {
						const folderCounts = this.store.getCardCountsByCategoryForFolder(file.path);
						menu.addItem((item) => {
							item.setTitle(`复习文件夹卡片 (${folderCounts.new}/${folderCounts.learning}/${folderCounts.review})`)
								.setIcon("layers")
								.onClick(() => {
									this.startFolderReview(file.path);
								});
						});
					}
					return;
				}

				if (!(file instanceof TFile) || file.extension !== "md") return;

				const cardCount = this.store.getCardCount(file.path);
				const dueCount = this.store.getDueCardCount(file.path);

				menu.addItem((item) => {
					item.setTitle(`卡片预览 (${cardCount})`)
						.setIcon("list")
						.onClick(() => {
							this.openLocalCardPreview(file.path);
						});
				});

				if (cardCount > 0) {
					menu.addItem((item) => {
							const fileCounts = this.store.getCardCountsByCategory(file.path);
						item.setTitle(`复习卡片 (${fileCounts.new}/${fileCounts.learning}/${fileCounts.review})`)
							.setIcon("layers")
							.onClick(() => {
								this.startFileReview(file.path);
							});
					});
				}
			})
		);
	}

	private registerImageContextMenu(): void {
		// 阅读模式/实时预览：DOM右键菜单
		this.registerDomEvent(document, "contextmenu", (evt: MouseEvent) => {
			const target = evt.target as HTMLElement;
			if (!(target instanceof HTMLImageElement)) return;

			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view?.file) return;

			const imagePath = this.resolveImagePath(target, view.file.path);
			if (!imagePath) return;

			evt.preventDefault();
			evt.stopPropagation();

			const menu = new Menu();
			menu.addItem((item) => {
				item.setTitle("制作遮挡图片卡片")
					.setIcon("image-file")
					.onClick(() => {
						this.openImageOcclusionEditor(imagePath, view.file!.path);
					});
			});
			menu.showAtMouseEvent(evt);
		});

		// 源码模式：editor-menu 检测图片语法
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, view) => {
				const selection = editor.getSelection();
				if (selection) return;

				const cursor = editor.getCursor("from");
				const line = editor.getLine(cursor.line);
				const imagePath = this.parseImageFromLine(line, view.file?.path ?? "");
				if (!imagePath) return;

				menu.addItem((item) => {
					item.setTitle("制作遮挡图片卡片")
						.setIcon("image-file")
						.onClick(() => {
							const file = view.file;
							if (!file) return;
							this.openImageOcclusionEditor(imagePath, file.path);
						});
				});
			})
		);
	}

	private resolveImagePath(img: HTMLImageElement, sourcePath: string): string | null {
		const alt = img.getAttribute("alt")?.trim();
		if (alt) {
			const resolved = this.app.metadataCache.getFirstLinkpathDest(alt, sourcePath);
			if (resolved) return resolved.path;
		}

		const src = img.getAttribute("src") ?? img.currentSrc;
		if (src) {
			try {
				const url = new URL(src);
				let path = decodeURIComponent(url.pathname);
				if (path.startsWith("/")) path = path.slice(1);
				const file = this.app.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) return file.path;
			} catch {
				// 忽略解析错误
			}
		}

		return null;
	}

	private parseImageFromLine(line: string, sourcePath: string): string | null {
		const wikiMatch = line.match(/!\[\[([^\]]+\.(?:png|jpg|jpeg|gif|svg|webp|bmp))\]\]/i);
		if (wikiMatch) {
			const linkpath = wikiMatch[1]!.split("|")[0]!;
			const resolved = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
			return resolved ? resolved.path : null;
		}

		const mdMatch = line.match(/!\[.*?\]\(([^)]+\.(?:png|jpg|jpeg|gif|svg|webp|bmp))\)/i);
		if (mdMatch) {
			const linkpath = mdMatch[1]!;
			const resolved = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
			return resolved ? resolved.path : null;
		}

		return null;
	}

	private openImageOcclusionEditor(imagePath: string, sourcePath: string): void {
		new ImageOcclusionModal(
			this.app,
			imagePath,
			sourcePath,
			async (cards: CardData[]) => {
				for (const card of cards) {
					await this.store.addCard(card);
				}
				new Notice(`已创建 ${cards.length} 张遮挡卡片`);
				this.handleCardsChanged();
			}
		).open();
	}

	private openGlobalCardPreview(): void {
		new CardPreviewModal(this.app, {
			store: this.store,
			scope: "global",
			onDataChanged: () => this.handleCardsChanged(),
		}).open();
	}

	private openLocalCardPreview(filePath: string): void {
		new CardPreviewModal(this.app, {
			store: this.store,
			scope: "local",
			filePath,
			onDataChanged: () => this.handleCardsChanged(),
		}).open();
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
					this.handleCardsChanged();
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

	private reviewActionEl: HTMLElement | null = null;
	private localPreviewActionEl: HTMLElement | null = null;

	private registerReviewAction(): void {
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.updateReviewAction();
			})
		);
		this.registerEvent(
			this.app.workspace.on("file-open", () => {
				this.updateReviewAction();
			})
		);
		this.app.workspace.onLayoutReady(() => {
			this.updateReviewAction();
		});
	}

	private updateReviewAction(): void {
		this.clearReviewAction();

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view?.file) return;

		const dueCount = this.store.getDueCardCount(view.file.path);
		const cardCount = this.store.getCardCount(view.file.path);
			const fileCounts = this.store.getCardCountsByCategory(view.file.path);

		this.localPreviewActionEl = view.addAction(
			"list",
			`局部卡片预览 (${cardCount})`,
			() => {
				if (view.file) {
					this.openLocalCardPreview(view.file.path);
				}
			}
		);
		this.localPreviewActionEl.addClass("newanki-local-preview-action");

		if (cardCount <= 0) return;

		this.reviewActionEl = view.addAction("layers", `复习卡片 (${fileCounts.new}/${fileCounts.learning}/${fileCounts.review})`, () => {
			if (view.file) {
				this.startFileReview(view.file.path);
			}
		});
		this.reviewActionEl.addClass("newanki-review-action");

		if (dueCount > 0) {
			const badge = this.reviewActionEl.createEl("span", {
				text: dueCount >= 100 ? "99+" : String(dueCount),
				cls: "newanki-badge",
			});
			badge.setAttr("aria-label", `新卡:${fileCounts.new} 学习:${fileCounts.learning} 复习:${fileCounts.review}`);
		}
	}

	private clearReviewAction(): void {
		if (this.reviewActionEl) {
			this.reviewActionEl.remove();
			this.reviewActionEl = null;
		}
		if (this.localPreviewActionEl) {
			this.localPreviewActionEl.remove();
			this.localPreviewActionEl = null;
		}

		document
			.querySelectorAll<HTMLElement>(
				[
					".view-action.newanki-review-action",
					".view-action.newanki-local-preview-action",
					".view-action[aria-label^='复习卡片 (']",
					".view-action[aria-label^='局部卡片预览 (']",
				].join(", ")
			)
			.forEach((el) => el.remove());
	}

	private registerFileEvents(): void {
		this.registerEvent(
			this.app.vault.on("create", async (file: TAbstractFile) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;

				// 检测是否是 journals/ 文件夹下的 daily note
				const match = file.path.match(/^journals\/(\d{4})_(\d{2})_(\d{2})\.md$/);
				if (!match) return;

				const year = parseInt(match[1]!, 10);
				const month = parseInt(match[2]!, 10) - 1;
				const day = parseInt(match[3]!, 10);
				const targetDate = new Date(year, month, day);

				const dueFiles = this.store.getFilesWithDueCardsByDate(targetDate);
				if (dueFiles.length === 0) return;

				// 生成链接文本：取文件名（不含路径和扩展名）
				const links = dueFiles.map(f => {
					const name = f.replace(/^.*\//, "").replace(/\.md$/, "");
					return `[[${name}]]`;
				}).join(", ");

				const reviewSection = `\n## Review\n${links}\n`;

				// 延迟写入，等待 Calendar 插件完成模板写入
				setTimeout(async () => {
					const content = await this.app.vault.read(file);
					// 已存在 ## Review 字段则跳过，避免重复追加（vault 初次加载时 create 事件会对已有文件触发）
					if (/^##\s+Review\s*$/m.test(content)) return;
					await this.app.vault.modify(file, content + reviewSection);
				}, 500);
			})
		);

		this.registerEvent(
			this.app.vault.on("rename", async (file: TAbstractFile, oldPath: string) => {
				if (file instanceof TFile && file.extension !== "md") return;
				const changed = await this.store.handleFileRename(oldPath, file.path);
				if (changed) {
					this.handleCardsChanged();
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("delete", async (file: TAbstractFile) => {
				if (file instanceof TFile && file.extension !== "md") return;
				const changed = await this.store.handleFileDelete(file.path);
				if (changed) {
					this.handleCardsChanged();
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
		// 设置卡片为正在学习队列中
		await Promise.all(
			dueCards.map(card => {
				if (card.inLearningQueue !== true) {
					card.inLearningQueue = true;
					return this.store.updateCard(card);
				}
				return Promise.resolve();
			})
		).catch(error => {
			console.error("Failed to set cards in learning queue:", error);
		});
		reviewView.startReview(dueCards, false, filePath);
	}

	private async startFolderReview(folderPath: string): Promise<void> {
		const dueCards = this.store.getDueCardsForFolder(folderPath);
		if (dueCards.length === 0) {
			new Notice("该文件夹没有到期的卡片。");
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
		// 设置卡片为正在学习队列中
		await Promise.all(
			dueCards.map(card => {
				if (card.inLearningQueue !== true) {
					card.inLearningQueue = true;
					return this.store.updateCard(card);
				}
				return Promise.resolve();
			})
		).catch(error => {
			console.error("Failed to set cards in learning queue:", error);
		});
		reviewView.startReview(dueCards, true, null);
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
		// 设置卡片为正在学习队列中
		await Promise.all(
			dueCards.map(card => {
				if (card.inLearningQueue !== true) {
					card.inLearningQueue = true;
					return this.store.updateCard(card);
				}
				return Promise.resolve();
			})
		).catch(error => {
			console.error("Failed to set cards in learning queue:", error);
		});
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

	private updateGlobalReviewRibbonBadge(): void {
		if (!this.globalReviewRibbonEl) return;
			// 更新工具提示标题
			const globalCounts = this.store.getTotalCardCountsByCategory();
			this.globalReviewRibbonEl.setAttr("title", "NewAnki 全局复习 (" + globalCounts.new + "/" + globalCounts.learning + "/" + globalCounts.review + ")");

		if (this.globalReviewBadgeEl) {
			this.globalReviewBadgeEl.remove();
			this.globalReviewBadgeEl = null;
		}

			const totalDue = this.store.getTotalDueCount();
		if (totalDue <= 0) return;

		this.globalReviewBadgeEl = this.globalReviewRibbonEl.createEl("span", {
			text: totalDue >= 100 ? "99+" : String(totalDue),
			cls: "newanki-badge newanki-ribbon-badge",
		});
		this.globalReviewBadgeEl.setAttr("aria-label", `全局 - 新卡:${globalCounts.new} 学习:${globalCounts.learning} 复习:${globalCounts.review}`);
	}
}
