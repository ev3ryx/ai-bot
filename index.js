require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  InteractionResponseType,
  InteractionResponseFlags
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

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const cooldown = new Map();

// ================= COMMANDS =================
const commands = [
  new SlashCommandBuilder()
    .setName("setai")
    .setDescription("Set AI personality")
    .addStringOption(option =>
      option
        .setName("prompt")
        .setDescription("Enter AI personality prompt")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setaichannel")
    .setDescription("Set AI auto reply channel")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Select channel for AI replies")
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

// ================= SAFE SEND =================
async function sendAIReply(msg, reply) {
  try {
    if (!reply || typeof reply !== "string") {
      return msg.reply("⚠️ Invalid AI response.");
    }

    reply = reply.replace(/@everyone|@here/g, "");

    const chunks = [];
    for (let i = 0; i < reply.length; i += 1900) {
      chunks.push(reply.slice(i, i + 1900));
    }

    for (let i = 0; i < chunks.length; i++) {
      const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setAuthor({ name: "🤖 AI Response" })
        .setDescription(chunks[i])
        .setFooter({
          text: `Requested by ${msg.author.username} • Part ${i + 1}/${chunks.length}`
        });

      await msg.reply({ embeds: [embed] });
    }
  } catch (err) {
    console.error("SEND ERROR:", err);
    msg.reply("❌ Failed to send message.");
  }
}

// ================= COMMAND HANDLER =================
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  const gid = i.guildId;

  if (i.commandName === "setai") {
    await db.set(`ai_prompt_${gid}`, i.options.getString("prompt"));
    return i.reply({ content: "✅ AI personality saved", flags: InteractionResponseFlags.Ephemeral });
  }

  if (i.commandName === "setaichannel") {
    await db.set(`ai_channel_${gid}`, i.options.getChannel("channel").id);
    return i.reply({ content: "📢 AI channel set", flags: InteractionResponseFlags.Ephemeral });
  }

  if (i.commandName === "removeaichannel") {
    await db.delete(`ai_channel_${gid}`);
    return i.reply({ content: "❌ Removed AI channel", flags: InteractionResponseFlags.Ephemeral });
  }

  if (i.commandName === "resetai") {
    await db.delete(`ai_memory_${gid}`);
    return i.reply({ content: "🧠 Memory reset", flags: InteractionResponseFlags.Ephemeral });
  }
});

// ================= AI SYSTEM =================
client.on("messageCreate", async msg => {
  if (msg.author.bot || !msg.guild) return;

  const gid = msg.guild.id;
  const channelId = await db.get(`ai_channel_${gid}`);
  if (msg.channel.id !== channelId) return;
  if (!msg.content) return;

  // cooldown
  if (cooldown.has(msg.author.id)) return;
  cooldown.set(msg.author.id, true);
  setTimeout(() => cooldown.delete(msg.author.id), 4000);

  const systemPrompt =
    (await db.get(`ai_prompt_${gid}`)) ||
    "You are a smart, friendly Discord AI bot.";

  let memory = await db.get(`ai_memory_${gid}`);
  if (!Array.isArray(memory)) memory = [];

  memory.push({ role: "user", content: msg.content });
  if (memory.length > 6) memory.shift(); // limit memory for stability

  try {
    await msg.channel.sendTyping();

    const chat = await groq.chat.completions.create({
      model: "mixtral-8x7b-32768", // ✅ working model
      messages: [
        { role: "system", content: systemPrompt },
        ...memory
      ],
      temperature: 0.7,
      max_tokens: 1024
    });

    const reply = chat.choices?.[0]?.message?.content || "⚠️ No response";

    memory.push({ role: "assistant", content: reply });
    await db.set(`ai_memory_${gid}`, memory);

    await sendAIReply(msg, reply);

  } catch (err) {
    console.error("AI ERROR FULL:", JSON.stringify(err, null, 2));
    msg.reply("❌ AI failed. Check logs.");
  }
});

// ================= LOGIN =================
client.login(process.env.TOKEN);
