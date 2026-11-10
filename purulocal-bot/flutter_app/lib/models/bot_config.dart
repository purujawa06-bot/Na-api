class BotConfig {
  String botName;
  String ownerName;
  String ownerNumber;
  String botNumber;
  bool blockSelfChat;
  String? updateManifestUrl;

  BotConfig({
    this.botName = 'puruLocal Bot',
    this.ownerName = '',
    this.ownerNumber = '',
    this.botNumber = '',
    this.blockSelfChat = true,
    this.updateManifestUrl,
  });

  factory BotConfig.fromJson(Map<String, dynamic> j) => BotConfig(
        botName: j['bot_name'] ?? 'puruLocal Bot',
        ownerName: j['owner_name'] ?? '',
        ownerNumber: j['owner_number'] ?? '',
        botNumber: j['bot_number'] ?? '',
        blockSelfChat: j['block_self_chat'] ?? true,
        updateManifestUrl: j['update_manifest_url'],
      );

  Map<String, dynamic> toJson() => {
        'bot_name': botName.isEmpty ? 'puruLocal Bot' : botName,
        'owner_name': ownerName,
        'owner_number': ownerNumber,
        'bot_number': botNumber.isEmpty ? ownerNumber : botNumber,
        'block_self_chat': blockSelfChat,
        'update_manifest_url': updateManifestUrl,
      };
}