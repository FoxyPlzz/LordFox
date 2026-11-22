
import {
    Events,
    EmbedBuilder,
    PermissionFlagsBits,
    AttachmentBuilder
} from 'discord.js';

import { createCanvas, loadImage } from '@napi-rs/canvas';

import { getColor, botConfig } from '../config/bot.js';
import { getGuildConfig } from '../services/config/guildConfig.js';
import {
    getWelcomeConfig,
    setBirthday as dbSetBirthday
} from '../utils/database.js';
import { formatWelcomeMessage } from '../utils/welcome.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import {
    getServerCounters,
    updateCounter
} from '../services/serverstatsService.js';
import { logger } from '../utils/logger.js';

export default {
    name: Events.GuildMemberAdd,
    once: false,

    async execute(member) {
        try {
            const { guild, user } = member;

            const config = await getGuildConfig(member.client, guild.id);
            const welcomeConfig = await getWelcomeConfig(member.client, guild.id);

            const welcomeChannelId = welcomeConfig?.channelId;

            // WELCOME SYSTEM
            if (welcomeConfig?.enabled && welcomeChannelId) {
                const channel = guild.channels.cache.get(welcomeChannelId);
                const me = guild.members.me;

                const permissions =
                    channel?.isTextBased?.() && me
                        ? channel.permissionsFor(me)
                        : null;

                if (
                    permissions?.has([
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages
                    ])
                ) {
                    const formatData = { user, guild, member };

                    const welcomeMessage = formatWelcomeMessage(
                        welcomeConfig.welcomeMessage ||
                        welcomeConfig.welcomeEmbed?.description ||
                        botConfig.welcome?.defaultWelcomeMessage ||
                        'Welcome {user} to {server}!',
                        formatData
                    );

                    const messageContent = welcomeConfig.welcomePing
                        ? user.toString()
                        : null;

                    const embedTitle = formatWelcomeMessage(
                        welcomeConfig.welcomeEmbed?.title || '🎉 Welcome!',
                        formatData
                    );

                    const embedFooter = welcomeConfig.welcomeEmbed?.footer
                        ? formatWelcomeMessage(
                            welcomeConfig.welcomeEmbed.footer,
                            formatData
                        )
                        : `Welcome to ${guild.name}!`;

                    const canEmbed = permissions.has(
                        PermissionFlagsBits.EmbedLinks
                    );

                    if (!canEmbed) {
                        await channel.send({
                            content: messageContent || welcomeMessage
                        });
                    } else {
                        const embed = new EmbedBuilder()
                            .setColor(
                                welcomeConfig.welcomeEmbed?.color ||
                                getColor('success')
                            )
                            .setTitle(embedTitle)
                            .setDescription(welcomeMessage)
                            .setThumbnail(
                                user.displayAvatarURL({ extension: 'png' })
                            )
                            .addFields(
                                {
                                    name: 'User',
                                    value: `${user.tag} (${user.id})`,
                                    inline: true
                                },
                                {
                                    name: 'Member Count',
                                    value: guild.memberCount.toString(),
                                    inline: true
                                }
                            )
                            .setTimestamp()
                            .setFooter({ text: embedFooter });

                        let files = [];

                        // Use a custom generated image if no static image is configured.
                        if (welcomeConfig.welcomeImage) {
                            embed.setImage(welcomeConfig.welcomeImage);
                        } else if (welcomeConfig.welcomeEmbed?.image?.url) {
                            embed.setImage(
                                welcomeConfig.welcomeEmbed.image.url
                            );
                        } else {
                            try {
                                const imageBuffer =
                                    await generateWelcomeImage(member);

                                const attachment = new AttachmentBuilder(
                                    imageBuffer,
                                    { name: 'welcome-card.png' }
                                );

                                files.push(attachment);
                                embed.setImage(
                                    'attachment://welcome-card.png'
                                );
                            } catch (imageError) {
                                logger.error(
                                    'Failed to generate welcome image:',
                                    imageError
                                );
                            }
                        }

                        await channel.send({
                            content: messageContent,
                            embeds: [embed],
                            files
                        });
                    }
                }
            }

            // AUTO ROLE
            if (welcomeConfig?.roleIds?.length > 0) {
                const delay = welcomeConfig.autoRoleDelay || 0;
                const roleId = welcomeConfig.roleIds[0];

                if (delay > 0) {
                    const timeout = setTimeout(async () => {
                        const role = guild.roles.cache.get(roleId);
                        if (role) {
                            await assignRoleSafely(member, role);
                        }
                    }, delay * 1000);

                    if (typeof timeout.unref === 'function') {
                        timeout.unref();
                    }
                } else {
                    const role = guild.roles.cache.get(roleId);
                    if (role) {
                        await assignRoleSafely(member, role);
                    }
                }
            }

            // VERIFICATION
            if (
                config?.verification?.enabled ||
                config?.verification?.autoVerify?.enabled
            ) {
                await handleVerification(
                    member,
                    guild,
                    config.verification,
                    member.client
                );
            }

            // JOIN LOGGING
            try {
                await logEvent({
                    client: member.client,
                    guildId: guild.id,
                    eventType: EVENT_TYPES.MEMBER_JOIN,
                    data: {
                        title: 'User joined',
                        lines: [
                            `**User:** ${user.toString()} (${user.displayName !== user.username ? `@${user.displayName}` : user.tag})`,
                            `**ID:** \`${user.id}\``,
                            `**Created:** <t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
                            `**Members:** ${guild.memberCount}`
                        ],
                        quoted: false,
                        thumbnail: user.displayAvatarURL(),
                        userId: user.id
                    }
                });
            } catch (error) {
                logger.debug('Error logging member join:', error);
            }

            // SERVER COUNTERS
            try {
                const counters = await getServerCounters(
                    member.client,
                    guild.id
                );

                for (const counter of counters) {
                    if (
                        counter?.type &&
                        counter.channelId &&
                        counter.enabled !== false
                    ) {
                        await updateCounter(
                            member.client,
                            guild,
                            counter
                        );
                    }
                }
            } catch (error) {
                logger.debug('Error updating counters on member join:', error);
            }

            // RESTORE BIRTHDAY
            try {
                const backupKey = `guild:${guild.id}:birthdays:left`;
                const backup = (await member.client.db.get(backupKey)) || {};

                if (backup[user.id]) {
                    const { month, day } = backup[user.id];

                    await dbSetBirthday(
                        member.client,
                        guild.id,
                        user.id,
                        month,
                        day
                    );

                    delete backup[user.id];
                    await member.client.db.set(backupKey, backup);

                    logger.debug(
                        `Birthday restored for user ${user.id} in guild ${guild.id}`
                    );
                }
            } catch (error) {
                logger.debug('Error restoring birthday on member join:', error);
            }

        } catch (error) {
            logger.error('Error in guildMemberAdd event:', error);
        }
    }
};


// GENERATE CUSTOM WELCOME IMAGE
async function generateWelcomeImage(member) {
    const width = 1000;
    const height = 350;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Background
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#014BAA');
    gradient.addColorStop(1, '#080F1C');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Decorative circles
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#69AFFF';
    ctx.beginPath();
    ctx.arc(920, 40, 180, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(50, 330, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Avatar
    const avatar = await loadImage(
        member.user.displayAvatarURL({
            extension: 'png',
            size: 256
        })
    );

    ctx.save();

    ctx.beginPath();
    ctx.arc(175, 175, 100, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    ctx.drawImage(avatar, 75, 75, 200, 200);

    ctx.restore();

    // Avatar border
    ctx.beginPath();
    ctx.arc(175, 175, 103, 0, Math.PI * 2);
    ctx.strokeStyle = '#69AFFF';
    ctx.lineWidth = 6;
    ctx.stroke();

    // Welcome heading
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 52px Arial';
    ctx.fillText('WELCOME!', 330, 115);

    // Username
    ctx.fillStyle = '#69AFFF';
    ctx.font = 'bold 38px Arial';

    const displayName =
        member.displayName || member.user.username;

    ctx.fillText(
        displayName.length > 24
            ? displayName.slice(0, 21) + '...'
            : displayName,
        330,
        175
    );

    // Server name
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '26px Arial';
    ctx.fillText(member.guild.name, 330, 225);

    // Member count
    ctx.fillStyle = '#B9D8FF';
    ctx.font = '22px Arial';
    ctx.fillText(
        `YOU ARE MEMBER #${member.guild.memberCount}`,
        330,
        280
    );

    // Bottom branding
    ctx.fillStyle = '#69AFFF';
    ctx.font = 'bold 18px Arial';
    ctx.fillText('FOXY CLUB', 820, 325);

    return canvas.encode('png');
}


// VERIFICATION
async function handleVerification(member, guild, verificationConfig, client) {
    const { autoVerifyOnJoin } =
        await import('../services/verificationService.js');

    try {
        const result = await autoVerifyOnJoin(
            client,
            guild,
            member,
            verificationConfig
        );

        if (result.autoVerified) {
            logger.info('User auto-verified on join', {
                guildId: guild.id,
                userId: member.id,
                userTag: member.user.tag,
                roleName: result.roleName,
                criteria: result.criteria
            });
        } else {
            logger.debug('User not auto-verified on join', {
                guildId: guild.id,
                userId: member.id,
                reason: result.reason
            });
        }

    } catch (error) {
        logger.error('Error in auto-verification for member', {
            guildId: guild.id,
            userId: member.id,
            userTag: member.user.tag,
            error: error.message
        });
    }
}


// SAFE ROLE ASSIGNMENT
async function assignRoleSafely(member, role) {
    try {
        await member.roles.add(role);
    } catch (error) {
        logger.warn(
            `Failed to assign role ${role.id} to member ${member.id}:`,
            error
        );
    }
}
