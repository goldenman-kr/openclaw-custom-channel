import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

enum ChatHistoryRole { user, assistant, system }

class ChatHistoryMessage {
  const ChatHistoryMessage({
    required this.role,
    required this.text,
    required this.createdAt,
  });

  final ChatHistoryRole role;
  final String text;
  final DateTime createdAt;

  Map<String, Object?> toJson() => {
    'role': role.name,
    'text': text,
    'createdAt': createdAt.toIso8601String(),
  };

  static ChatHistoryMessage fromJson(Map<String, Object?> json) {
    return ChatHistoryMessage(
      role: ChatHistoryRole.values.firstWhere(
        (item) => item.name == json['role'],
        orElse: () => ChatHistoryRole.system,
      ),
      text: (json['text'] as String?) ?? '',
      createdAt:
          DateTime.tryParse((json['createdAt'] as String?) ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0),
    );
  }
}

class ChatHistoryRepository {
  ChatHistoryRepository(this._preferences);

  final SharedPreferences _preferences;
  static const _chatHistoryKey = 'chat.history.v1';
  static const _maxStoredMessages = 500;

  Future<List<ChatHistoryMessage>> load() async {
    final raw = _preferences.getString(_chatHistoryKey);
    if (raw == null || raw.trim().isEmpty) {
      return const [];
    }

    try {
      final decoded = jsonDecode(raw) as List<dynamic>;
      return decoded
          .whereType<Map<String, dynamic>>()
          .map((item) => ChatHistoryMessage.fromJson(item))
          .toList(growable: false);
    } catch (_) {
      return const [];
    }
  }

  Future<void> save(List<ChatHistoryMessage> messages) async {
    final normalized = messages.length <= _maxStoredMessages
        ? messages
        : messages.sublist(messages.length - _maxStoredMessages);
    final encoded = jsonEncode(
      normalized.map((item) => item.toJson()).toList(growable: false),
    );
    await _preferences.setString(_chatHistoryKey, encoded);
  }
}
