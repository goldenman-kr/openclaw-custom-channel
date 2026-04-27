class SlashCommand {
  const SlashCommand({required this.command, required this.description});

  final String command;
  final String description;
}

const supportedSlashCommands = [
  SlashCommand(
    command: '/status',
    description: 'Show OpenClaw gateway/session status',
  ),
  SlashCommand(
    command: '/new',
    description: 'Start a new conversation/session',
  ),
  SlashCommand(command: '/reset', description: 'Reset current session'),
  SlashCommand(command: '/models', description: 'Show available models'),
];
