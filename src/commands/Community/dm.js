
import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits
} from 'discord.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import {
    ErrorTypes,
    replyUserError
} from '../../utils/errorHandler.js';

export default {
    data: new SlashCommandBuilder()
        .setName('dm')
        .setDescription('Send a private announcement to opted-in role members')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addRoleOption(option =>
            option
                .setName('role')
                .setDescription('Choose the recipient role')
                .setRequired(true))
        .addStringOption(option =>
            option
                .setName('message')
                .setDescription('Write your announcement')
                .setMaxLength(2000)
                .setRequired(true)),

    async execute(interaction) {
        try {
            const deferSuccess = await InteractionHelper.safeDefer(interaction);
            if (!deferSuccess) return;

            // Check administrator permission
            if (!interaction.memberPermissions?.has(
                PermissionFlagsBits.Administrator
            )) {
                return await replyUserError(interaction, {
                    type: ErrorTypes.PERMISSION,
                    message: 'Only server administrators can use this command.'
                });
            }

            const role = interaction.options.getRole('role');
            const message = interaction.options.getString('message');

            if (!message?.trim()) {
                return await replyUserError(interaction, {
                    type: ErrorTypes.VALIDATION,
                    message: 'Message cannot be empty.'
                });
            }

            const members = await interaction.guild.members.fetch();
            const recipients = members.filter(member =>
                !member.user.bot && member.roles.cache.has(role.id)
            );
            });
        }
    }
};
