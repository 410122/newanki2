//数据存储相关
import { Plugin } from "obsidian";
import { CardData, PluginData, PluginSettings, ReviewLogData, DEFAULT_PLUGIN_DATA, State } from "./models";
import { timeService } from "./timeService";

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
			if (!this.data.reviewLogs) {
				this.data.reviewLogs = {};
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

	//获取文件所有卡片
	getCardsForFile(filePath: string): CardData[] {
		return this.data.cards[filePath] ?? [];
	}

	//获取到期卡片
	getDueCardsForFile(filePath: string): CardData[] {
		const now = timeService.now();
		return this.getCardsForFile(filePath).filter((c) => this.isCardDue(c, now));
	}

	//全局查询
	getAllCards(): CardData[] {
		const all: CardData[] = [];
		for (const cards of Object.values(this.data.cards)) {
			all.push(...cards);
		}
		return all;
	}

	getAllDueCards(): CardData[] {
		const now = timeService.now();
		return this.getAllCards().filter((c) => this.isCardDue(c, now));
	}

	//到期时间计算
	private isCardDue(card: CardData, now: Date): boolean {
		// 如果卡片正在学习队列中，则视为到期
		if (card.inLearningQueue === true) {
			return true;
		}

		const dueMs = Date.parse(card.due);
		if (Number.isNaN(dueMs)) {
			return false;
		}

		// Review cards are day-based in UX: once the due date arrives, show it all day.
		if (card.state === State.Review) {
			return this.getLocalDayStartMs(new Date(dueMs)) <= this.getLocalDayStartMs(now);
		}

		// New/Learning/Relearning cards remain time-based.
		return dueMs <= now.getTime();
	}

	private getLocalDayStartMs(date: Date): number {
		return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
	}

	// 获取指定日期有到期卡片的文件列表
	getFilesWithDueCardsByDate(targetDate: Date): string[] {
		const targetDayStart = this.getLocalDayStartMs(targetDate);
		const targetDayEnd = targetDayStart + 24 * 60 * 60 * 1000 - 1;
		const files = new Set<string>();

		for (const [filePath, cards] of Object.entries(this.data.cards)) {
			for (const card of cards) {
				const dueMs = Date.parse(card.due);
				if (Number.isNaN(dueMs)) continue;

				let isDue = false;
				if (card.state === State.Review) {
					isDue = this.getLocalDayStartMs(new Date(dueMs)) <= targetDayStart;
				} else {
					isDue = dueMs <= targetDayEnd;
				}

				if (isDue) {
					files.add(filePath);
					break;
				}
			}
		}

		return Array.from(files);
	}

	getFilesWithCards(): string[] {
		return Object.keys(this.data.cards).filter(
			(k) => (this.data.cards[k]?.length ?? 0) > 0
		);
	}

	//添加新卡片
	async addCard(card: CardData): Promise<void> {
		const filePath = card.sourceFile;
		if (!this.data.cards[filePath]) {
			this.data.cards[filePath] = [];
		}
		this.data.cards[filePath].push(card);
		await this.save();
	}

	//更新卡片数据
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

	//删除指定卡片
	async deleteCard(cardId: string, filePath: string): Promise<void> {
		const cards = this.data.cards[filePath];
		if (!cards) return;

		this.data.cards[filePath] = cards.filter((c) => c.cardId !== cardId);
		if (this.data.cards[filePath].length === 0) {
			delete this.data.cards[filePath];
		}
		delete this.data.reviewLogs[cardId];
		await this.save();
	}

	// 复习日志相关
	async addReviewLog(log: ReviewLogData): Promise<void> {
		if (!this.data.reviewLogs[log.cardId]) {
			this.data.reviewLogs[log.cardId] = [];
		}
		this.data.reviewLogs[log.cardId]!.push(log);
		await this.save();
	}

	getReviewLogs(cardId: string): ReviewLogData[] {
		return this.data.reviewLogs[cardId] ?? [];
	}

	async resetReviewProgressForFile(filePath: string): Promise<number> {
		const cards = this.data.cards[filePath];
		if (!cards || cards.length === 0) return 0;

		const now = timeService.nowISO();
		this.data.cards[filePath] = cards.map((card) => ({
			...card,
			state: State.New,
			step: null,
			ease: null,
			due: now,
			currentInterval: null,
			inLearningQueue: false,
		}));
		await this.save();
		return cards.length;
	}

	//文件重命名处理--自动更新卡片中的源文件路径
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
	// 获取文件夹下所有卡片
	getCardsForFolder(folderPath: string): CardData[] {
		const prefix = folderPath + "/";
		const all: CardData[] = [];
		for (const [filePath, cards] of Object.entries(this.data.cards)) {
			if (filePath.startsWith(prefix)) {
				all.push(...cards);
			}
		}
		return all;
	}

	// 获取文件夹下所有到期卡片
	getDueCardsForFolder(folderPath: string): CardData[] {
		const now = timeService.now();
		return this.getCardsForFolder(folderPath).filter((c) => this.isCardDue(c, now));
	}

	// 获取文件夹级别的分类计数
	getCardCountsByCategoryForFolder(folderPath: string): { new: number; learning: number; review: number } {
		const cards = this.getCardsForFolder(folderPath);
		return this.calculateCategoryCounts(cards);
	}

	//统计计数，状态栏显示
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

	// 获取文件级别的分类计数
	getCardCountsByCategory(filePath: string): { new: number; learning: number; review: number } {
		const cards = this.getCardsForFile(filePath);
		return this.calculateCategoryCounts(cards);
	}

	// 获取全局级别的分类计数
	getTotalCardCountsByCategory(): { new: number; learning: number; review: number } {
		const cards = this.getAllCards();
		return this.calculateCategoryCounts(cards);
	}

	// 计算分类计数的辅助方法
	private calculateCategoryCounts(cards: CardData[]): { new: number; learning: number; review: number } {
		const now = timeService.now();
		let newCount = 0;
		let learningCount = 0;
		let reviewCount = 0;

		for (const card of cards) {
			const isDue = this.isCardDue(card, now);

			if (card.state === State.New) {
				// 新卡片：State.New状态
				newCount++;
			} else if (card.inLearningQueue === true && isDue) {
				// 正在学习的卡片：当日到期、在学习队列中（用户学习过但未毕业）
				learningCount++;
			} else if ((card.state === State.Review || card.state === State.Relearning) && isDue) {
				// 待复习的卡片：当日到期、状态为Review或Relearning，且不在学习队列中
				reviewCount++;
			}
			// 注意：State.Learning状态但不在学习队列中的卡片（尚未开始学习）不计入任何类别
			// 根据用户定义，它们既不是"新卡片"也不是"正在学习的卡片"
		}

		return { new: newCount, learning: learningCount, review: reviewCount };
	}
}
