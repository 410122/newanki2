export enum State {
	New = 0,
	Learning = 1,
	Review = 2,
	Relearning = 3,
}

export enum Rating {
	Again = 1,
	Hard = 2,
	Good = 3,
	Easy = 4,
}

export interface CardData {
	cardId: string;
	question: string;
	answer: string;
	sourceFile: string;
	lineStart: number;
	lineEnd: number;
	state: State;
	step: number | null;
	ease: number | null;
	due: string;
	currentInterval: number | null;
	createdAt: string;
}

export interface ReviewLogData {
	cardId: string;
	rating: Rating;
	reviewDatetime: string;
	prevState: State;
	prevEase: number | null;
	prevInterval: number | null;
}

export interface PluginSettings {
	learningSteps: number[];
	graduatingInterval: number;
	easyInterval: number;
	relearningSteps: number[];
	minimumInterval: number;
	maximumInterval: number;
	startingEase: number;
	easyBonus: number;
	intervalModifier: number;
	hardInterval: number;
	newInterval: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	learningSteps: [1, 10],
	graduatingInterval: 1,
	easyInterval: 4,
	relearningSteps: [10],
	minimumInterval: 1,
	maximumInterval: 36500,
	startingEase: 2.5,
	easyBonus: 1.3,
	intervalModifier: 1.0,
	hardInterval: 1.2,
	newInterval: 0.0,
};

export interface PluginData {
	settings: PluginSettings;
	cards: Record<string, CardData[]>;
}

export const DEFAULT_PLUGIN_DATA: PluginData = {
	settings: { ...DEFAULT_SETTINGS },
	cards: {},
};
