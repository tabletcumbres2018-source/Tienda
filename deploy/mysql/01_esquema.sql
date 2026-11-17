-- Esquema MySQL para Hostgator (phpMyAdmin > Importar). Equivalente a MegaStoreDB de SQL Server.
-- Importa primero este archivo y después 02_productos.sql.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS Resenas;
DROP TABLE IF EXISTS CorreosPedido;
DROP TABLE IF EXISTS DetallePedido;
DROP TABLE IF EXISTS Pedidos;
DROP TABLE IF EXISTS Anuncios;
DROP TABLE IF EXISTS Productos;

CREATE TABLE Productos (
    Id              INT AUTO_INCREMENT PRIMARY KEY,
    Titulo          VARCHAR(300)  NOT NULL,
    Categoria       VARCHAR(100)  NOT NULL,
    Marca           VARCHAR(100)  NOT NULL,
    Precio          DECIMAL(10,2) NOT NULL,
    Caracteristicas TEXT          NOT NULL,
    Colores         VARCHAR(400)  NOT NULL,
    Imagen          VARCHAR(510)  NOT NULL,
    KEY IX_Productos_Categoria (Categoria)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE Pedidos (
    Id              INT AUTO_INCREMENT PRIMARY KEY,
    Folio           VARCHAR(20)   NULL UNIQUE,            -- MS-000001 (lo asigna la API al guardar)
    ClienteNombre   VARCHAR(100)  NOT NULL,
    ClienteCorreo   VARCHAR(150)  NOT NULL,
    Direccion       VARCHAR(300)  NOT NULL,
    Referencias     VARCHAR(500)  NOT NULL,
    CodigoPostal    CHAR(5)       NOT NULL,
    EstadoEnvio     VARCHAR(50)   NOT NULL,
    DistanciaKm     INT           NOT NULL,
    Subtotal        DECIMAL(10,2) NOT NULL,
    CostoEnvio      DECIMAL(10,2) NOT NULL,
    Total           DECIMAL(10,2) NOT NULL,
    Estado          ENUM('Pendiente','Pagado','Enviado','Entregado','Cancelado') NOT NULL DEFAULT 'Pagado',
    MetodoPago      VARCHAR(50)   NOT NULL,
    PagoReferencia  VARCHAR(60)   NULL,
    TarjetaUltimos4 CHAR(4)       NULL,
    Fecha           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY IX_Pedidos_Correo (ClienteCorreo, Fecha),
    KEY IX_Pedidos_Fecha (Fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE DetallePedido (
    Id             INT AUTO_INCREMENT PRIMARY KEY,
    PedidoId       INT           NOT NULL,
    ProductoId     INT           NOT NULL,
    Producto       VARCHAR(300)  NOT NULL,
    Color          VARCHAR(50)   NOT NULL,
    Cantidad       INT           NOT NULL,
    PrecioUnitario DECIMAL(10,2) NOT NULL,
    CONSTRAINT FK_Detalle_Pedido   FOREIGN KEY (PedidoId)   REFERENCES Pedidos(Id),
    CONSTRAINT FK_Detalle_Producto FOREIGN KEY (ProductoId) REFERENCES Productos(Id),
    CONSTRAINT CK_Detalle_Cantidad CHECK (Cantidad > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE CorreosPedido (
    Id        INT AUTO_INCREMENT PRIMARY KEY,
    PedidoId  INT          NOT NULL,
    Para      VARCHAR(150) NOT NULL,
    Asunto    VARCHAR(200) NOT NULL,
    Cuerpo    TEXT         NOT NULL,
    Resultado ENUM('Enviado','Simulado','Error') NOT NULL,
    Detalle   VARCHAR(300) NULL,
    Fecha     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT FK_Correos_Pedido FOREIGN KEY (PedidoId) REFERENCES Pedidos(Id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE Resenas (
    Id            INT AUTO_INCREMENT PRIMARY KEY,
    ProductoId    INT          NOT NULL,
    ClienteNombre VARCHAR(100) NOT NULL,
    ClienteCorreo VARCHAR(150) NOT NULL,
    Calificacion  TINYINT      NOT NULL,
    Comentario    VARCHAR(500) NOT NULL,
    Fecha         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT FK_Resenas_Producto FOREIGN KEY (ProductoId) REFERENCES Productos(Id),
    CONSTRAINT CK_Resenas_Calif CHECK (Calificacion BETWEEN 1 AND 5),
    CONSTRAINT UQ_Resenas_UnaPorCliente UNIQUE (ProductoId, ClienteCorreo)   -- una reseña por cliente y producto
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE Anuncios (
    Id          INT AUTO_INCREMENT PRIMARY KEY,
    Tipo        ENUM('banner','producto') NOT NULL,
    Titulo      VARCHAR(100) NULL,
    Texto       VARCHAR(200) NULL,
    Boton       VARCHAR(40)  NULL,
    Categoria   VARCHAR(50)  NULL,
    Tema        ENUM('azul','morado','verde','naranja') NOT NULL DEFAULT 'azul',
    ProductoId  INT NULL,
    Orden       INT NOT NULL DEFAULT 0,
    Activo      TINYINT(1) NOT NULL DEFAULT 1,
    CONSTRAINT FK_Anuncios_Producto FOREIGN KEY (ProductoId) REFERENCES Productos(Id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
