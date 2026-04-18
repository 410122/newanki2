//设置界面，
// 配置：PluginSettingTab 类提供配置界面，
//       CardStore 类管理数据持久化，
//       PluginSettings 接口定义配置结构
import { App, PluginSettingTab, Setting } from "obsidian";
import type NewAnkiPlugin from "./main";

export class NewAnkiSettingTab extends PluginSettingTab {
	plugin: NewAnkiPlugin;

	constructor(app: App, plugin: NewAnkiPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "NewAnki 设置" });

		containerEl.createEl("h3", { text: "学习阶段" });

		new Setting(containerEl)
			.setName("学习步骤（分钟）")
			.setDesc("新卡片的学习步骤，用逗号分隔。例如: 1,10")
			.addText((text) =>
				text
					.setPlaceholder("1,10")
					.setValue(this.plugin.store.settings.learningSteps.join(","))
					.onChange(async (value) => {
						const steps = value
							.split(",")
							.map((s) => parseFloat(s.trim()))
							.filter((n) => !isNaN(n) && n > 0);
						this.plugin.store.settings.learningSteps = steps;
						await this.plugin.store.save();
					})
			);

		new Setting(containerEl)
			.setName("毕业间隔（天）")
			.setDesc("通过最后一个学习步骤后的复习间隔天数")
			.addText((text) =>
				text
					.setPlaceholder("1")
					.setValue(String(this.plugin.store.settings.graduatingInterval))
					.onChange(async (value) => {
						const n = parseInt(value);
						if (!isNaN(n) && n > 0) {
							this.plugin.store.settings.graduatingInterval = n;
							await this.plugin.store.save();
						}
					})
			);

		new Setting(containerEl)
			.setName("简单间隔（天）")
			.setDesc('在学习阶段直接按「简单」后的复习间隔天数')
			.addText((text) =>
				text
					.setPlaceholder("4")
					.setValue(String(this.plugin.store.settings.easyInterval))
					.onChange(async (value) => {
						const n = parseInt(value);
						if (!isNaN(n) && n > 0) {
							this.plugin.store.settings.easyInterval = n;
							await this.plugin.store.save();
						}
					})
			);

		containerEl.createEl("h3", { text: "复习参数" });

		new Setting(containerEl)
			.setName("重学步骤（分钟）")
			.setDesc("遗忘卡片的重学步骤，用逗号分隔。例如: 10")
			.addText((text) =>
				text
					.setPlaceholder("10")
					.setValue(this.plugin.store.settings.relearningSteps.join(","))
					.onChange(async (value) => {
						const steps = value
							.split(",")
							.map((s) => parseFloat(s.trim()))
							.filter((n) => !isNaN(n) && n > 0);
						this.plugin.store.settings.relearningSteps = steps;
						await this.plugin.store.save();
					})
			);

		new Setting(containerEl)
			.setName("初始难度因子")
			.setDesc("卡片毕业时的初始 ease 值（推荐 2.5）")
			.addText((text) =>
				text
					.setPlaceholder("2.5")
					.setValue(String(this.plugin.store.settings.startingEase))
					.onChange(async (value) => {
						const n = parseFloat(value);
						if (!isNaN(n) && n >= 1.3) {
							this.plugin.store.settings.startingEase = n;
							await this.plugin.store.save();
						}
					})
			);

		new Setting(containerEl)
			.setName("最大间隔（天）")
			.setDesc("复习间隔的上限天数")
			.addText((text) =>
				text
					.setPlaceholder("36500")
					.setValue(String(this.plugin.store.settings.maximumInterval))
					.onChange(async (value) => {
						const n = parseInt(value);
						if (!isNaN(n) && n > 0) {
							this.plugin.store.settings.maximumInterval = n;
							await this.plugin.store.save();
						}
					})
			);

		new Setting(containerEl)
			.setName("最小间隔（天）")
			.setDesc('按「重来」后的最小间隔天数')
			.addText((text) =>
				text
					.setPlaceholder("1")
					.setValue(String(this.plugin.store.settings.minimumInterval))
					.onChange(async (value) => {
						const n = parseInt(value);
						if (!isNaN(n) && n > 0) {
							this.plugin.store.settings.minimumInterval = n;
							await this.plugin.store.save();
						}
					})
			);

		new Setting(containerEl)
			.setName("简单奖励系数")
			.setDesc('按「简单」时额外乘以的系数（推荐 1.3）')
			.addText((text) =>
				text
					.setPlaceholder("1.3")
					.setValue(String(this.plugin.store.settings.easyBonus))
					.onChange(async (value) => {
						const n = parseFloat(value);
						if (!isNaN(n) && n >= 1.0) {
							this.plugin.store.settings.easyBonus = n;
							await this.plugin.store.save();
						}
					})
			);

		new Setting(containerEl)
			.setName("间隔修改器")
			.setDesc("全局间隔倍率（1.0 表示不修改）")
			.addText((text) =>
				text
					.setPlaceholder("1.0")
					.setValue(String(this.plugin.store.settings.intervalModifier))
					.onChange(async (value) => {
						const n = parseFloat(value);
						if (!isNaN(n) && n > 0) {
							this.plugin.store.settings.intervalModifier = n;
							await this.plugin.store.save();
						}
					})
			);

		new Setting(containerEl)
			.setName("困难间隔系数")
			.setDesc('按「困难」时乘以的间隔系数（推荐 1.2）')
			.addText((text) =>
				text
					.setPlaceholder("1.2")
					.setValue(String(this.plugin.store.settings.hardInterval))
					.onChange(async (value) => {
						const n = parseFloat(value);
						if (!isNaN(n) && n > 0) {
							this.plugin.store.settings.hardInterval = n;
							await this.plugin.store.save();
						}
					})
			);

		new Setting(containerEl)
			.setName("遗忘后新间隔系数")
			.setDesc('按「重来」后保留原间隔的比例（0 表示从头开始）')
			.addText((text) =>
				text
					.setPlaceholder("0")
					.setValue(String(this.plugin.store.settings.newInterval))
					.onChange(async (value) => {
						const n = parseFloat(value);
						if (!isNaN(n) && n >= 0 && n <= 1) {
							this.plugin.store.settings.newInterval = n;
							await this.plugin.store.save();
						}
					})
			);
	}
}
