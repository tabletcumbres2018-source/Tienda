-- Bitácora de correos de estado del pedido (se puede ejecutar varias veces)
USE MegaStoreDB;
GO

IF OBJECT_ID('dbo.CorreosPedido') IS NULL
CREATE TABLE dbo.CorreosPedido (
    Id        INT IDENTITY(1,1) PRIMARY KEY,
    PedidoId  INT            NOT NULL CONSTRAINT FK_Correos_Pedido FOREIGN KEY REFERENCES dbo.Pedidos(Id),
    Para      NVARCHAR(150)  NOT NULL,
    Asunto    NVARCHAR(200)  NOT NULL,
    Cuerpo    NVARCHAR(MAX)  NOT NULL,
    Resultado NVARCHAR(20)   NOT NULL CONSTRAINT CK_Correos_Resultado CHECK (Resultado IN ('Enviado','Simulado','Error')),
    Detalle   NVARCHAR(300)  NULL,
    Fecha     DATETIME2      NOT NULL CONSTRAINT DF_Correos_Fecha DEFAULT SYSDATETIME()
);
GO
