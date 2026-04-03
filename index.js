require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder
} = require("discord.js");

const Groq = require("groq-sdk");
const { QuickDB } = require("quick.db");

const db = new QuickDB();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const cooldown = new Map();

// 📦 Commands
const commands = [
  new SlashCommandBuilder()
    .setName("setai")
    .setDescription("Set AI personality")
    .addStringOption(o =>
      o.setName("prompt")
        .setDescription("Enter AI personality") // ✅ fixed
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setaichannel")
    .setDescription("Set AI auto reply channel")
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Channel for AI replies") // ✅ fixed
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("removeaichannel")
    .setDescription("Disable AI channel"),

  new SlashCommandBuilder()
    .setName("resetai")
    .setDescription("Reset AI memory")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

// 🚀 Register
(async () => {
  try {
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log("✅ Commands loaded");
  } catch (err) {
    console.error(err);
  }
})();

// 🎯 Commands
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  const gid = i.guildId;

  if (i.commandName === "setai") {
    await db.set(`ai_prompt_${gid}`, i.options.getString("prompt"));
    return i.reply({ content: "✅ AI personality saved", ephemeral: true });
  }

  if (i.commandName === "setaichannel") {
    await db.set(`ai_channel_${gid}`, i.options.getChannel("channel").id);
    return i.reply({ content: "📢 AI channel set", ephemeral: true });
  }

  if (i.commandName === "removeaichannel") {
    await db.delete(`ai_channel_${gid}`);
    return i.reply({ content: "❌ Removed AI channel", ephemeral: true });
  }

  if (i.commandName === "resetai") {
    await db.delete(`ai_memory_${gid}`);
    return i.reply({ content: "🧠 Memory reset", ephemeral: true });
  }
});

// 💬 AI SYSTEM
client.on("messageCreate", async msg => {
  if (msg.author.bot || !msg.guild) return;

  const gid = msg.guild.id;
  const channelId = await db.get(`ai_channel_${gid}`);

  if (msg.channel.id !== channelId) return;

  // ⏱ cooldown
  if (cooldown.has(msg.author.id)) return;
  cooldown.set(msg.author.id, true);
  setTimeout(() => cooldown.delete(msg.author.id), 3000);

  const systemPrompt =
    (await db.get(`ai_prompt_${gid}`)) ||
    "You are a smart, friendly Discord AI bot.";

  let memory = (await db.get(`ai_memory_${gid}`)) || [];

  memory.push({ role: "user", content: msg.content });
  if (memory.length > 10) memory.shift();

  try {
    // ✨ typing effect
    await msg.channel.sendTyping();

    const chat = await groq.chat.completions.create({
      model: "llama3-70b-8192",
      messages: [
        { role: "system", content: systemPrompt },
        ...memory
      ]
    });

    const reply = chat.choices[0].message.content;

    memory.push({ role: "assistant", content: reply });
    await db.set(`ai_memory_${gid}`, memory);

    // 📦 embed reply
    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setAuthor({ name: "🤖 AI Response" })
      .setDescription(reply.slice(0, 4000))
      .setFooter({ text: `Requested by ${msg.author.username}` });

    msg.reply({ embeds: [embed] });

  } catch (err) {
    console.error(err);
    msg.reply("❌ AI error occurred.");
  }
});

// 🔌 login
client.login(process.env.TOKEN);
