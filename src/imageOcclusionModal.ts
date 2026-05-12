import { App, Modal, Notice, TFile } from "obsidian";
import { CardData, OcclusionRect, State } from "./models";
import { timeService } from "./timeService";

export class ImageOcclusionModal extends Modal {
	private imagePath: string;
	private sourceFilePath: string;
	private onSubmit: (cards: CardData[]) => Promise<void>;

	private imageEl: HTMLImageElement | null = null;
	private canvasEl: HTMLCanvasElement | null = null;
	private ctx: CanvasRenderingContext2D | null = null;
	private occlusions: OcclusionRect[] = [];
	private listContainer: HTMLElement | null = null;

	private drawing = false;
	private startX = 0;
	private startY = 0;
	private currentRect: OcclusionRect | null = null;
	private displayWidth = 0;
	private displayHeight = 0;
	private naturalWidth = 0;
	private naturalHeight = 0;

	constructor(
		app: App,
		imagePath: string,
		sourceFilePath: string,
		onSubmit: (cards: CardData[]) => Promise<void>
	) {
		super(app);
		this.imagePath = imagePath;
		this.sourceFilePath = sourceFilePath;
		this.onSubmit = onSubmit;
	}

	async onOpen(): Promise<void> {
		this.containerEl.addClass("newanki-occlusion-modal");
		this.contentEl.empty();

		const header = this.contentEl.createDiv({ cls: "newanki-occlusion-header" });
		header.createEl("h3", { text: "制作遮挡图片卡片" });
		header.createEl("p", {
			cls: "newanki-occlusion-hint",
			text: "在图片上拖拽鼠标绘制矩形遮挡区域。每个遮挡区域将生成一张卡片。",
		});

		const imageContainer = this.contentEl.createDiv({
			cls: "newanki-occlusion-image-container",
		});

		const imageFile = this.app.vault.getAbstractFileByPath(this.imagePath);
		if (!(imageFile instanceof TFile)) {
			imageContainer.createEl("div", {
				cls: "newanki-occlusion-error",
				text: `找不到图片文件: ${this.imagePath}`,
			});
			return;
		}

		const resourcePath = this.app.vault.getResourcePath(imageFile);

		this.imageEl = imageContainer.createEl("img", {
			cls: "newanki-occlusion-image",
		});
		this.imageEl.src = resourcePath;

		this.imageEl.onload = () => {
			this.naturalWidth = this.imageEl!.naturalWidth;
			this.naturalHeight = this.imageEl!.naturalHeight;
			this.displayWidth = this.imageEl!.clientWidth;
			this.displayHeight = this.imageEl!.clientHeight;

			this.canvasEl = imageContainer.createEl("canvas", {
				cls: "newanki-occlusion-canvas",
			});
			this.canvasEl.width = this.displayWidth;
			this.canvasEl.height = this.displayHeight;
			this.ctx = this.canvasEl.getContext("2d")!;

			this.setupCanvasEvents();
			this.redrawCanvas();
		};

		this.imageEl.onerror = () => {
			imageContainer.createEl("div", {
				cls: "newanki-occlusion-error",
				text: "图片加载失败",
			});
		};

		this.listContainer = this.contentEl.createDiv({
			cls: "newanki-occlusion-list",
		});
		this.listContainer.createEl("div", {
			cls: "newanki-occlusion-list-title",
			text: "遮挡区域列表",
		});
		this.renderOcclusionList();

		const footer = this.contentEl.createDiv({
			cls: "newanki-occlusion-footer",
		});
		const createBtn = footer.createEl("button", {
			text: "生成卡片",
			cls: "mod-cta",
		});
		createBtn.addEventListener("click", async () => {
			await this.createCards();
		});

		const cancelBtn = footer.createEl("button", { text: "取消" });
		cancelBtn.addEventListener("click", () => this.close());
	}

	private setupCanvasEvents(): void {
		if (!this.canvasEl) return;

		this.canvasEl.addEventListener("mousedown", (e) => {
			const rect = this.canvasEl!.getBoundingClientRect();
			const scaleX = this.naturalWidth / rect.width;
			const scaleY = this.naturalHeight / rect.height;
			this.startX = (e.clientX - rect.left) * scaleX;
			this.startY = (e.clientY - rect.top) * scaleY;
			this.drawing = true;

			this.currentRect = {
				id: this.generateId(),
				x: (this.startX / this.naturalWidth) * 100,
				y: (this.startY / this.naturalHeight) * 100,
				width: 0,
				height: 0,
			};
		});

		this.canvasEl.addEventListener("mousemove", (e) => {
			if (!this.drawing || !this.currentRect || !this.ctx || !this.canvasEl) return;

			const rect = this.canvasEl.getBoundingClientRect();
			const scaleX = this.naturalWidth / rect.width;
			const scaleY = this.naturalHeight / rect.height;
			const currentX = (e.clientX - rect.left) * scaleX;
			const currentY = (e.clientY - rect.top) * scaleY;

			const x = Math.min(this.startX, currentX);
			const y = Math.min(this.startY, currentY);
			const w = Math.abs(currentX - this.startX);
			const h = Math.abs(currentY - this.startY);

			this.currentRect.x = (x / this.naturalWidth) * 100;
			this.currentRect.y = (y / this.naturalHeight) * 100;
			this.currentRect.width = (w / this.naturalWidth) * 100;
			this.currentRect.height = (h / this.naturalHeight) * 100;

			this.redrawCanvas();
			if (this.currentRect.width > 0 && this.currentRect.height > 0) {
				this.drawRect(this.currentRect, true);
			}
		});

		this.canvasEl.addEventListener("mouseup", () => {
			if (!this.drawing || !this.currentRect) return;
			this.drawing = false;

			if (this.currentRect.width > 0.5 && this.currentRect.height > 0.5) {
				this.occlusions.push(this.currentRect);
				this.renderOcclusionList();
			}

			this.currentRect = null;
			this.redrawCanvas();
		});

		this.canvasEl.addEventListener("mouseleave", () => {
			if (!this.drawing) return;
			this.drawing = false;
			this.currentRect = null;
			this.redrawCanvas();
		});
	}

	private drawRect(occlusion: OcclusionRect, isTemp: boolean): void {
		if (!this.ctx || !this.canvasEl) return;

		const canvasW = this.canvasEl.width;
		const canvasH = this.canvasEl.height;

		const x = (occlusion.x / 100) * canvasW;
		const y = (occlusion.y / 100) * canvasH;
		const w = (occlusion.width / 100) * canvasW;
		const h = (occlusion.height / 100) * canvasH;

		this.ctx.fillStyle = isTemp
			? "rgba(255, 0, 0, 0.3)"
			: "rgba(255, 0, 0, 0.4)";
		this.ctx.fillRect(x, y, w, h);
		this.ctx.strokeStyle = isTemp ? "rgba(255, 0, 0, 0.8)" : "rgba(200, 0, 0, 0.9)";
		this.ctx.lineWidth = 2;
		this.ctx.strokeRect(x, y, w, h);
	}

	private redrawCanvas(): void {
		if (!this.ctx || !this.canvasEl) return;
		this.ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);

		for (const occ of this.occlusions) {
			this.drawRect(occ, false);
		}
	}

	private renderOcclusionList(): void {
		if (!this.listContainer) return;

		// 清空列表（保留标题）
		while (this.listContainer.childNodes.length > 1) {
			this.listContainer.lastChild?.remove();
		}

		if (this.occlusions.length === 0) {
			this.listContainer.createEl("div", {
				cls: "newanki-occlusion-list-empty",
				text: "暂无遮挡区域，在图片上拖拽鼠标绘制",
			});
			return;
		}

		for (let i = 0; i < this.occlusions.length; i++) {
			const occ = this.occlusions[i]!;
			const item = this.listContainer.createDiv({
				cls: "newanki-occlusion-list-item",
			});
			item.createEl("span", {
				text: `遮挡 ${i + 1}: (${occ.x.toFixed(1)}%, ${occ.y.toFixed(1)}%) ${occ.width.toFixed(1)}% × ${occ.height.toFixed(1)}%`,
			});

			const deleteBtn = item.createEl("button", {
				text: "删除",
				cls: "mod-warning",
			});
			deleteBtn.addEventListener("click", () => {
				this.occlusions = this.occlusions.filter((o) => o.id !== occ.id);
				this.renderOcclusionList();
				this.redrawCanvas();
			});
		}
	}

	private async createCards(): Promise<void> {
		if (this.occlusions.length === 0) {
			new Notice("请先在图片上绘制遮挡区域");
			return;
		}

		const cards: CardData[] = this.occlusions.map((occ) => {
			const imgMarkdown = `![[${this.imagePath}]]`;
			return {
				cardId: this.generateId(),
				question: imgMarkdown,
				answer: imgMarkdown,
				sourceFile: this.sourceFilePath,
				lineStart: 0,
				lineEnd: 0,
				state: State.New,
				step: null,
				ease: null,
				due: timeService.nowISO(),
				currentInterval: null,
				createdAt: timeService.nowISO(),
				cardType: "image-occlusion",
				imagePath: this.imagePath,
				occlusion: occ,
			};
		});

		await this.onSubmit(cards);
		new Notice(`已生成 ${cards.length} 张遮挡卡片`);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private generateId(): string {
		return (
			timeService.nowTimestamp().toString(36) +
			Math.random().toString(36).substring(2, 9)
		);
	}
}
