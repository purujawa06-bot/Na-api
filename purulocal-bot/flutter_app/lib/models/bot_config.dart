class BotConfig {
  String botName;
  String ownerName;
  String ownerNumber;
  String botNumber;
  bool blockSelfChat;
  String? updateManifestUrl;
  bool readChat;
  bool typingBeforeReply;
  double typingDelaySec;

  BotConfig({
    this.botName = 'puruLocal Bot',
    this.ownerName = '',
    this.ownerNumber = '',
    this.botNumber = '',
    this.blockSelfChat = true,
    this.updateManifestUrl,
    this.readChat = false,
    this.typingBeforeReply = true,
    this.typingDelaySec = 1.5,
  });

  factory BotConfig.fromJson(Map<String, dynamic> j) => BotConfig(
        botName: j['bot_name'] ?? 'puruLocal Bot',
        ownerName: j['owner_name'] ?? '',
        ownerNumber: j['owner_number'] ?? '',
        botNumber: j['bot_number'] ?? '',
        blockSelfChat: j['block_self_chat'] ?? true,
        updateManifestUrl: j['update_manifest_url'],
        readChat: j['read_chat'] ?? false,
        typingBeforeReply: j['typing_before_reply'] ?? true,
        typingDelaySec: (j['typing_delay_sec'] is num) ? (j['typing_delay_sec'] as num).toDouble() : 1.5,
      );

  Map<String, dynamic> toJson() => {
        'bot_name': botName.isEmpty ? 'puruLocal Bot' : botName,
        'owner_name': ownerName,
        'owner_number': ownerNumber,
        'bot_number': botNumber.isEmpty ? ownerNumber : botNumber,
        'block_self_chat': blockSelfChat,
        'update_manifest_url': updateManifestUrl,
        'read_chat': readChat,
        'typing_before_reply': typingBeforeReply,
        'typing_delay_sec': typingDelaySec,
      };
}