const maxAttachments = 3;
const maxAttachmentBytes = 5 * 1024 * 1024;
const maxTotalAttachmentBytes = 10 * 1024 * 1024;

const allowedImageMimeTypes = {'image/jpeg', 'image/png', 'image/webp'};
const allowedFileMimeTypes = {
  'application/pdf',
  'text/plain',
  'application/zip',
};

class MessageAttachment {
  const MessageAttachment({
    required this.type,
    required this.name,
    required this.mimeType,
    required this.contentBase64,
  });

  final String type;
  final String name;
  final String mimeType;
  final String contentBase64;

  Map<String, Object?> toJson() => {
    'type': type,
    'name': name,
    'mime_type': mimeType,
    'content_base64': contentBase64,
  };
}

class MessageRequest {
  const MessageRequest({required this.message, this.attachments = const []});

  final String message;
  final List<MessageAttachment> attachments;

  Map<String, Object?> toJson() {
    final json = <String, Object?>{'message': message};
    if (attachments.isNotEmpty) {
      json['attachments'] = attachments.map((item) => item.toJson()).toList();
    }
    return json;
  }
}

class MessageResponse {
  const MessageResponse({
    required this.reply,
    required this.requestId,
    required this.sessionId,
  });

  final String reply;
  final String requestId;
  final String sessionId;

  factory MessageResponse.fromJson(Map<String, Object?> json) {
    return MessageResponse(
      reply: json['reply'] as String,
      requestId: json['request_id'] as String,
      sessionId: json['session_id'] as String,
    );
  }
}

class ApiErrorResponse {
  const ApiErrorResponse({
    required this.code,
    required this.message,
    required this.requestId,
    this.details,
  });

  final String code;
  final String message;
  final String requestId;
  final Map<String, Object?>? details;

  factory ApiErrorResponse.fromJson(Map<String, Object?> json) {
    final error = json['error'] as Map<String, Object?>;
    return ApiErrorResponse(
      code: error['code'] as String,
      message: error['message'] as String,
      details: error['details'] as Map<String, Object?>?,
      requestId: json['request_id'] as String,
    );
  }
}

MessageRequest buildMessageRequest({
  required String message,
  List<MessageAttachment> attachments = const [],
}) {
  final trimmedMessage = message.trim();
  if (trimmedMessage.isEmpty) {
    throw ArgumentError('message is required.');
  }

  if (trimmedMessage.startsWith('/') && attachments.isNotEmpty) {
    throw ArgumentError('slash commands cannot include attachments.');
  }

  if (attachments.length > maxAttachments) {
    throw ArgumentError('attachments must be <= $maxAttachments.');
  }

  return MessageRequest(message: trimmedMessage, attachments: attachments);
}
