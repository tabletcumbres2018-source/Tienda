-- Tablas de pedidos para MegaStoreDB (se puede ejecutar varias veces sin romper nada)
USE MegaStoreDB;
GO

IF OBJECT_ID('dbo.Pedidos') IS NULL
CREATE TABLE dbo.Pedidos (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    Folio           AS ('MS-' + RIGHT('000000' + CAST(Id AS VARCHAR(10)), 6)) PERSISTED,
    ClienteNombre   NVARCHAR(100)  NOT NULL,
    ClienteCorreo   NVARCHAR(150)  NOT NULL,
    Direccion       NVARCHAR(300)  NOT NULL,
    Referencias     NVARCHAR(500)  NOT NULL,
    CodigoPostal    CHAR(5)        NOT NULL,
    EstadoEnvio     NVARCHAR(50)   NOT NULL,   -- estado de la república que resuelve el CP
    DistanciaKm     INT            NOT NULL,
    Subtotal        DECIMAL(10,2)  NOT NULL,
    CostoEnvio      DECIMAL(10,2)  NOT NULL,
    Total           DECIMAL(10,2)  NOT NULL,
    Estado          NVARCHAR(20)   NOT NULL CONSTRAINT DF_Pedidos_Estado DEFAULT 'Pagado',
    MetodoPago      NVARCHAR(50)   NOT NULL,
    PagoReferencia  NVARCHAR(60)   NULL,
    TarjetaUltimos4 CHAR(4)        NULL,
    Fecha           DATETIME2      NOT NULL CONSTRAINT DF_Pedidos_Fecha DEFAULT SYSDATETIME(),
    CONSTRAINT CK_Pedidos_Estado CHECK (Estado IN ('Pendiente','Pagado','Enviado','Entregado','Cancelado'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Pedidos_Correo')
    CREATE INDEX IX_Pedidos_Correo ON dbo.Pedidos (ClienteCorreo, Fecha DESC);
GO

IF OBJECT_ID('dbo.DetallePedido') IS NULL
CREATE TABLE dbo.DetallePedido (
    Id             INT IDENTITY(1,1) PRIMARY KEY,
    PedidoId       INT            NOT NULL CONSTRAINT FK_Detalle_Pedido   FOREIGN KEY REFERENCES dbo.Pedidos(Id),
    ProductoId     INT            NOT NULL CONSTRAINT FK_Detalle_Producto FOREIGN KEY REFERENCES dbo.Productos(Id),
    Producto       NVARCHAR(300)  NOT NULL,
    Color          NVARCHAR(50)   NOT NULL,
    Cantidad       INT            NOT NULL CHECK (Cantidad > 0),
    PrecioUnitario DECIMAL(10,2)  NOT NULL
);
GO
