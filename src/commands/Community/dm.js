
import {
    SlashCommandBuilder,
    EmbedBuilder
} from 'discord.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import {
    ErrorTypes,
    replyUserError
} from '../../utils/errorHandler.js';

const OWNER_ID = '1152943439688761404';

export default {
    data: new SlashCommandBuilder()
        .setName('dm')
        .setDescription('Send a private message to a server member')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The member who will receive the DM')
                .setRequired(true))
        .addStringOption(option =>
            option
                .setName('message')
                .setDescription('The message to send')
                .setMaxLength(2000)
                .setRequired(true)),

    async execute(interaction) {
        try {
            const deferSuccess = await InteractionHelper.safeDefer(interaction);
            if (!deferSuccess) return;

            // Owner permission check
            if (interaction.user.id !== OWNER_ID) {
                return await replyUserError(interaction, {
                    type: ErrorTypes.PERMISSION,
                    message: 'Only the bot owner can use this command.'
                });
            }

            const user = interaction.options.getUser('user');
            const message = interaction.options.getString('message');

            if (!message?.trim()) {
                return await replyUserError(interaction, {
                    type: ErrorTypes.VALIDATION,
                    message: 'Message cannot be empty.'
                });
            }

            try {
                const embed = new EmbedBuilder()
                    .setColor(0x168BFF)
                    .setDescription(message)
                    .setFooter({
                        text: `Message from ${interaction.guild?.name || 'TitanBot'}`
                    })
                    .setTimestamp();

                await user.send({
                    embeds: [embed],
                    allowedMentions: { parse: [] }
                });

                logger.info(
                    `[DM] Message sent to ${user.id} by ${interaction.user.id}`
                );

                return await InteractionHelper.safeEditReply(interaction, {
                    content: `✅ Successfully sent your DM to **${user.username}**.`
                });

            } catch (error) {
                logger.warn(`[DM] Failed to send DM to ${user.id}:`, error);

                return await InteractionHelper.safeEditReply(interaction, {
                    content: `❌ Couldn't DM **${user.username}**. Their privacy settings may prevent it.`
                });
            }

        } catch (error) {
            logger.error('[DM] Command error:', error);

            return await replyUserError(interaction, {
                type: ErrorTypes.UNKNOWN,
                message: 'An error occurred while sending the DM.'
            });
        }
    }
};
