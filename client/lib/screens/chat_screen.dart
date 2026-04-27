import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../engine/attachment_service.dart';
import '../engine/chat_engine.dart';
import '../engine/location_service.dart';
import '../models/api_contract_v1.dart';
import '../models/slash_command.dart';
import '../settings/app_settings.dart';

enum _ChatMessageRole { user, assistant, system }

class _ChatMessage {
  const _ChatMessage({required this.role, required this.text});

  final _ChatMessageRole role;
  final String text;
}

class ChatScreen extends StatefulWidget {
  const ChatScreen({
    required this.settings,
    this.chatEngine = const ChatEngine(),
    super.key,
  });

  final AppSettings settings;
  final ChatEngine chatEngine;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _messageController = TextEditingController();
  final _attachmentService = AttachmentService();
  final _locationService = const LocationService();
  final _messages = <_ChatMessage>[];
  final _attachments = <MessageAttachment>[];
  bool _isSending = false;
  bool _sendCurrentLocation = false;
  String _currentInput = '';

  bool get _hasServerSettings =>
      widget.settings.apiUrl.trim().isNotEmpty &&
      widget.settings.apiKey.trim().isNotEmpty;

  List<SlashCommand> get _commandSuggestions {
    if (!_currentInput.startsWith('/')) {
      return const [];
    }

    return supportedSlashCommands
        .where((item) => item.command.startsWith(_currentInput))
        .toList();
  }

  @override
  void dispose() {
    _messageController.dispose();
    super.dispose();
  }

  Future<void> _sendMessage() async {
    final message = _messageController.text.trim();
    if (message.isEmpty || _isSending) {
      return;
    }

    if (!_hasServerSettings) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('서버 연결 설정이 필요합니다.')));
      return;
    }

    final isSlashCommand = message.startsWith('/');
    if (isSlashCommand && _attachments.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('슬래시 명령어에는 사진/파일 첨부를 사용할 수 없습니다.')),
      );
      return;
    }

    setState(() {
      _isSending = true;
    });

    try {
      var outgoingMessage = message;
      if (_sendCurrentLocation && !isSlashCommand) {
        final locationText = await _locationService.currentLocationText();
        outgoingMessage = '$message\n\n$locationText';
      }

      final outgoingAttachments = List<MessageAttachment>.unmodifiable(
        _attachments,
      );
      setState(() {
        _messages.add(
          _ChatMessage(
            role: _ChatMessageRole.user,
            text: _formatUserMessage(outgoingMessage, outgoingAttachments),
          ),
        );
        _messageController.clear();
        _currentInput = '';
        _attachments.clear();
      });

      final response = await widget.chatEngine.sendMessage(
        settings: widget.settings,
        message: outgoingMessage,
        attachments: outgoingAttachments,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _messages.add(
          _ChatMessage(role: _ChatMessageRole.assistant, text: response.reply),
        );
      });
    } on Object catch (error) {
      if (!mounted) {
        return;
      }

      final message = switch (error) {
        ChatEngineException() => error.message,
        LocationServiceException() =>
          '${error.message} 위치 없이 전송하려면 현재위치전송을 해제해주세요.',
        AttachmentServiceException() => error.message,
        _ => '메시지 전송에 실패했습니다.',
      };
      setState(() {
        _messages.add(
          _ChatMessage(role: _ChatMessageRole.system, text: message),
        );
      });
    } finally {
      if (mounted) {
        setState(() {
          _isSending = false;
        });
      }
    }
  }

  Future<void> _showAttachmentMenu() async {
    if (_currentInput.startsWith('/')) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('슬래시 명령어에는 사진/파일 첨부를 사용할 수 없습니다.')),
      );
      return;
    }

    final selected = await showModalBottomSheet<_AttachmentAction>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.image_outlined),
              title: const Text('사진 첨부'),
              onTap: () => Navigator.of(context).pop(_AttachmentAction.image),
            ),
            ListTile(
              leading: const Icon(Icons.attach_file),
              title: const Text('파일 첨부'),
              onTap: () => Navigator.of(context).pop(_AttachmentAction.file),
            ),
          ],
        ),
      ),
    );

    if (selected == null || !mounted) {
      return;
    }

    try {
      final attachment = switch (selected) {
        _AttachmentAction.image => await _attachmentService.pickImage(),
        _AttachmentAction.file => await _attachmentService.pickFile(),
      };

      if (attachment == null || !mounted) {
        return;
      }

      final nextAttachments = [..._attachments, attachment];
      if (nextAttachments.length > maxAttachments) {
        throw const AttachmentServiceException('첨부는 최대 3개까지 가능합니다.');
      }

      if (_totalAttachmentBytes(nextAttachments) > maxTotalAttachmentBytes) {
        throw const AttachmentServiceException('첨부 총 용량은 10MB 이하여야 합니다.');
      }

      setState(() {
        _attachments.add(attachment);
      });
    } on Object catch (error) {
      if (!mounted) {
        return;
      }
      final message = error is AttachmentServiceException
          ? error.message
          : '첨부 파일을 가져오지 못했습니다.';
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(message)));
    }
  }

  void _selectCommand(String command) {
    _messageController.text = command;
    _messageController.selection = TextSelection.collapsed(
      offset: command.length,
    );
    setState(() {
      _currentInput = command;
    });
  }

  @override
  Widget build(BuildContext context) {
    final commandSuggestions = _commandSuggestions;
    final isSlashInput = _currentInput.startsWith('/');

    return Scaffold(
      appBar: AppBar(
        title: const Text('OpenClaw Chat'),
        actions: [
          IconButton(
            tooltip: 'Settings',
            onPressed: () {
              Navigator.of(context).pushNamed('/settings');
            },
            icon: const Icon(Icons.settings),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: _messages.isEmpty
                ? const Center(child: Text('메시지 목록 영역'))
                : ListView.builder(
                    padding: const EdgeInsets.all(12),
                    itemCount: _messages.length,
                    itemBuilder: (context, index) {
                      return _MessageBubble(message: _messages[index]);
                    },
                  ),
          ),
          if (!_hasServerSettings)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Card(
                child: ListTile(
                  leading: const Icon(Icons.info_outline),
                  title: const Text('서버 연결 설정이 필요합니다.'),
                  subtitle: const Text('Settings에서 API URL과 API Key를 입력해주세요.'),
                  trailing: TextButton(
                    onPressed: () {
                      Navigator.of(context).pushNamed('/settings');
                    },
                    child: const Text('Settings'),
                  ),
                ),
              ),
            ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (commandSuggestions.isNotEmpty)
                    _CommandSuggestionPanel(
                      commands: commandSuggestions,
                      onSelected: _selectCommand,
                    ),
                  Row(
                    children: [
                      IconButton(
                        tooltip: '첨부',
                        onPressed: _isSending ? null : _showAttachmentMenu,
                        icon: const Icon(Icons.add),
                      ),
                      Expanded(
                        child: TextField(
                          controller: _messageController,
                          enabled: !_isSending,
                          minLines: 1,
                          maxLines: 4,
                          onSubmitted: (_) => _sendMessage(),
                          onChanged: (value) {
                            setState(() {
                              _currentInput = value.trim();
                              if (_currentInput.startsWith('/')) {
                                _attachments.clear();
                              }
                            });
                          },
                          textInputAction: TextInputAction.send,
                          decoration: const InputDecoration(
                            hintText: '메시지를 입력하세요',
                            border: OutlineInputBorder(),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      FilledButton(
                        onPressed: _isSending ? null : _sendMessage,
                        child: _isSending
                            ? const SizedBox.square(
                                dimension: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Text('Send'),
                      ),
                    ],
                  ),
                  CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    value: _sendCurrentLocation,
                    onChanged: _isSending || isSlashInput
                        ? null
                        : (value) {
                            setState(() {
                              _sendCurrentLocation = value ?? false;
                            });
                          },
                    title: const Text('현재위치전송'),
                    controlAffinity: ListTileControlAffinity.leading,
                  ),
                  if (_attachments.isNotEmpty)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Wrap(
                        spacing: 8,
                        runSpacing: 4,
                        children: [
                          for (final attachment in _attachments)
                            InputChip(
                              label: Text(attachment.name),
                              onDeleted: _isSending
                                  ? null
                                  : () {
                                      setState(() {
                                        _attachments.remove(attachment);
                                      });
                                    },
                            ),
                        ],
                      ),
                    ),
                  if (_sendCurrentLocation && !isSlashInput)
                    const Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        '전송 시 현재 GPS 좌표를 메시지 본문에 추가합니다.',
                        style: TextStyle(fontSize: 12),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

enum _AttachmentAction { image, file }

String _formatUserMessage(String message, List<MessageAttachment> attachments) {
  if (attachments.isEmpty) {
    return message;
  }

  final attachmentNames = attachments.map((item) => item.name).join(', ');
  return '$message\n\n첨부: $attachmentNames';
}

int _totalAttachmentBytes(List<MessageAttachment> attachments) {
  return attachments
      .map((item) => _decodedBase64Length(item.contentBase64))
      .fold(0, (total, bytes) => total + bytes);
}

int _decodedBase64Length(String base64Payload) {
  final trimmed = base64Payload.trim();
  if (trimmed.isEmpty) {
    return 0;
  }

  final paddingLength = trimmed.endsWith('==')
      ? 2
      : trimmed.endsWith('=')
      ? 1
      : 0;

  return ((trimmed.length * 3) ~/ 4) - paddingLength;
}

class _CommandSuggestionPanel extends StatelessWidget {
  const _CommandSuggestionPanel({
    required this.commands,
    required this.onSelected,
  });

  final List<SlashCommand> commands;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final command in commands)
            ListTile(
              dense: true,
              title: Text(command.command),
              subtitle: Text(command.description),
              onTap: () => onSelected(command.command),
            ),
        ],
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message});

  final _ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final isUser = message.role == _ChatMessageRole.user;
    final colorScheme = Theme.of(context).colorScheme;
    final alignment = isUser ? Alignment.centerRight : Alignment.centerLeft;
    final backgroundColor = switch (message.role) {
      _ChatMessageRole.user => colorScheme.primaryContainer,
      _ChatMessageRole.assistant => colorScheme.secondaryContainer,
      _ChatMessageRole.system => colorScheme.errorContainer,
    };

    return Align(
      alignment: alignment,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 320),
        child: Card(
          color: backgroundColor,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              mainAxisSize: MainAxisSize.min,
              children: [
                Align(
                  alignment: Alignment.centerLeft,
                  child: SelectableText(message.text),
                ),
                const SizedBox(height: 4),
                IconButton(
                  tooltip: '메시지 복사',
                  visualDensity: VisualDensity.compact,
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: message.text));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('메시지를 복사했습니다.')),
                    );
                  },
                  icon: const Icon(Icons.copy, size: 18),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
