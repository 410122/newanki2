import { Plugin } from "obsidian";
import { CardData, PluginData, PluginSettings, DEFAULT_PLUGIN_DATA } from "./models";

export class CardStore {
	private plugin: Plugin;
	private data: PluginData;

	constructor(plugin: Plugin) {
		this.plugin = plugin;
		this.data = { ...DEFAULT_PLUGIN_DATA };
	}

	async load(): Promise<void> {
		const saved = await this.plugin.loadData();
		if (saved) {
			this.data = Object.assign({}, DEFAULT_PLUGIN_DATA, saved);
			if (!this.data.cards) {
				this.data.cards = {};
			}
			if (!this.data.settings) {
				this.data.settings = { ...DEFAULT_PLUGIN_DATA.settings };
			}
		}
	}

	async save(): Promise<void> {
		await this.plugin.saveData(this.data);
	}

	get settings(): PluginSettings {
		return this.data.settings;
	}

	set settings(value: PluginSettings) {
		this.data.settings = value;
	}

	getCardsForFile(filePath: string): CardData[] {
		return this.data.cards[filePath] ?? [];
	}

	getDueCardsForFile(filePath: string): CardData[] {
		const now = new Date().toISOString();
		return this.getCardsForFile(filePath).filter((c) => c.due <= now);
	}

	getAllCards(): CardData[] {
		const all: CardData[] = [];
		for (const cards of Object.values(this.data.cards)) {
			all.push(...cards);
		}
		return all;
	}

	getAllDueCards(): CardData[] {
		const now = new Date().toISOString();
		return this.getAllCards().filter((c) => c.due <= now);
	}

	getFilesWithCards(): string[] {
		return Object.keys(this.data.cards).filter(
			(k) => (this.data.cards[k]?.length ?? 0) > 0
		);
	}

	async addCard(card: CardData): Promise<void> {
		const filePath = card.sourceFile;
		if (!this.data.cards[filePath]) {
			this.data.cards[filePath] = [];
		}
		this.data.cards[filePath].push(card);
		await this.save();
	}

	async updateCard(card: CardData): Promise<void> {
		const filePath = card.sourceFile;
		const cards = this.data.cards[filePath];
		if (!cards) return;

		const idx = cards.findIndex((c) => c.cardId === card.cardId);
		if (idx !== -1) {
			cards[idx] = card;
			await this.save();
		}
	}

	async deleteCard(cardId: string, filePath: string): Promise<void> {
		const cards = this.data.cards[filePath];
		if (!cards) return;

		this.data.cards[filePath] = cards.filter((c) => c.cardId !== cardId);
		if (this.data.cards[filePath].length === 0) {
			delete this.data.cards[filePath];
		}
		await this.save();
	}

	async handleFileRename(oldPath: string, newPath: string): Promise<boolean> {
		let changed = false;
		const entries = Object.entries(this.data.cards);
		const oldPrefix = `${oldPath}/`;
		const newPrefix = `${newPath}/`;

		for (const [path, cards] of entries) {
			const isExact = path === oldPath;
			const isChild = path.startsWith(oldPrefix);
			if (!isExact && !isChild) continue;

			const targetPath = isExact ? newPath : path.replace(oldPrefix, newPrefix);
			const migrated = cards.map((c) => ({
				...c,
				sourceFile: targetPath,
			}));

			if (this.data.cards[targetPath]) {
				this.data.cards[targetPath] = [
					...this.data.cards[targetPath],
					...migrated,
				];
			} else {
				this.data.cards[targetPath] = migrated;
			}
			delete this.data.cards[path];
			changed = true;
		}

		if (changed) {
			await this.save();
		}
		return changed;
	}

	async handleFileDelete(filePath: string): Promise<boolean> {
		let changed = false;
		const prefix = `${filePath}/`;

		for (const path of Object.keys(this.data.cards)) {
			if (path === filePath || path.startsWith(prefix)) {
				delete this.data.cards[path];
				changed = true;
			}
		}

		if (changed) {
			await this.save();
		}
		return changed;
	}

	getCardCount(filePath: string): number {
		return this.getCardsForFile(filePath).length;
	}

	getDueCardCount(filePath: string): number {
		return this.getDueCardsForFile(filePath).length;
	}

	getTotalCardCount(): number {
		return this.getAllCards().length;
	}

	getTotalDueCount(): number {
		return this.getAllDueCards().length;
	}
}
