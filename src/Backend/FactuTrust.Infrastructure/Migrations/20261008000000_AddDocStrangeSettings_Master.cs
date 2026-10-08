using FactuTrust.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FactuTrust.Infrastructure.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(MasterDbContext))]
    [Migration("20261008000000_AddDocStrangeSettings_Master")]
    public partial class AddDocStrangeSettings_Master : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "DocStrangeIsEnabled",
                table: "PlatformAiSettings",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "DocStrangeDisplayName",
                table: "PlatformAiSettings",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DocStrangeBaseUrl",
                table: "PlatformAiSettings",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DocStrangeEncryptedApiKey",
                table: "PlatformAiSettings",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DocStrangeApiKeyLast4",
                table: "PlatformAiSettings",
                type: "nvarchar(4)",
                maxLength: 4,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "DocStrangeIsEnabled", table: "PlatformAiSettings");
            migrationBuilder.DropColumn(name: "DocStrangeDisplayName", table: "PlatformAiSettings");
            migrationBuilder.DropColumn(name: "DocStrangeBaseUrl", table: "PlatformAiSettings");
            migrationBuilder.DropColumn(name: "DocStrangeEncryptedApiKey", table: "PlatformAiSettings");
            migrationBuilder.DropColumn(name: "DocStrangeApiKeyLast4", table: "PlatformAiSettings");
        }
    }
}
