require("dotenv").config();
const { 
  Client, 
  GatewayIntentBits, 
  SlashCommandBuilder, 
  REST, 
  Routes 
} = require("discord.js");

const OpenAI = require("openai");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Store settings
const aiSettings = new Map(); // guildId -> prompt
const aiChannels = new Map(); // guildId -> channelId

// 📦 Slash Commands
const commands = [
  new SlashCommandBuilder()
    .setName("setai")
    .setDescription("Set AI personality")
    .addStringOption(option =>
      option.setName("prompt")
        .setDescription("AI personality")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setaichannel")
    .setDescription("Set channel for auto AI replies")
    .addChannelOption(option =>
      option.setName("channel")
        .setDescription("Select channel")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("removeaichannel")
    .setDescription("Disable AI auto replies")
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    await rest.put(
      Routes.applicationCommands("YOUR_CLIENT_ID"),
      { body: commands }
    );
    console.log("✅ Commands loaded");
  } catch (err) {
    console.error(err);
  }
})();

// 🎯 Slash Commands
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const guildId = interaction.guildId;

  if (interaction.commandName === "setai") {
    const prompt = interaction.options.getString("prompt");
    aiSettings.set(guildId, prompt);

    return interaction.reply({
      content: `✅ AI personality set:\n**${prompt}**`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "setaichannel") {
    const channel = interaction.options.getChannel("channel");
    aiChannels.set(guildId, channel.id);

    return interaction.reply({
      content: `📢 AI will now reply in ${channel}`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "removeaichannel") {
    aiChannels.delete(guildId);

    return interaction.reply({
      content: `❌ AI auto channel removed`,
      ephemeral: true
    });
  }
});

// 💬 Auto AI Reply
client.on("messageCreate", async message => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const guildId = message.guild.id;

  // Only reply in selected channel
  if (aiChannels.get(guildId) !== message.channel.id) return;

  const systemPrompt = aiSettings.get(guildId) || "You are a helpful Discord AI bot.";

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message.content }
      ]
    });

    const reply = res.choices[0].message.content;

    // avoid long spam
    if (reply.length > 2000) {
      return message.reply(reply.slice(0, 2000));
    }

    message.reply(reply);

  } catch (err) {
    console.error(err);
  }
});

// 🔌 Login
client.login(process.env.TOKEN);
